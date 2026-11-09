defmodule StarsmapApi.CommunityPerformanceTest do
  @moduledoc """
  The database work of the photo lists and of the upload completion: one page of rows, a fixed
  number of queries, no storage request inside a transaction, and a bounded solver command.
  """
  use ExUnit.Case, async: false
  import Ecto.Query

  alias StarsmapApi.Community.{
    Action,
    MediaWorker,
    Photo,
    Photos,
    Ranking,
    SolverWorker,
    Storage,
    Subjects,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  # A storage adapter that tells the test when its head request runs, and can wait for a signal.
  defmodule ProbeStorage do
    alias StarsmapApi.Community.Storage

    def head(photo) do
      pid = Application.fetch_env!(:starsmap_api, :community_test_head_pid)
      send(pid, {:head, self(), StarsmapApi.CommunityRepo.in_transaction?()})

      if Application.get_env(:starsmap_api, :community_test_head_waits) do
        receive do
          :continue -> :ok
        after
          3_000 -> :ok
        end
      end

      Storage.Local.head(photo)
    end
  end

  defmodule FailingStorage do
    def get(_key, _path), do: {:error, :timeout}
  end

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)

    user = user("author")
    {:ok, subject} = Subjects.ensure("moon")
    {:ok, user: user, subject: subject}
  end

  describe "the completion of an upload" do
    setup %{user: user} do
      storage = Application.fetch_env!(:starsmap_api, :community_storage)
      Application.put_env(:starsmap_api, :community_storage, ProbeStorage)
      Application.put_env(:starsmap_api, :community_test_head_pid, self())

      on_exit(fn ->
        Application.put_env(:starsmap_api, :community_storage, storage)
        Application.delete_env(:starsmap_api, :community_test_head_pid)
        Application.delete_env(:starsmap_api, :community_test_head_waits)
      end)

      {:ok, photo: uploaded_photo(user)}
    end

    test "runs the storage request outside a transaction", %{user: user, photo: photo} do
      assert {:ok, %Photo{status: "processing"} = done} = Photos.complete(user, photo.id)
      assert_received {:head, _, false}
      assert done.assets["source_etag"] == "local-write-once"
      assert media_jobs(photo) == 1
    end

    test "two parallel calls overlap in the storage request and queue one media job", %{
      user: user,
      photo: photo
    } do
      Application.put_env(:starsmap_api, :community_test_head_waits, true)

      {result, queries} =
        queries(fn ->
          tasks = for _ <- 1..2, do: Task.async(fn -> Photos.complete(user, photo.id) end)

          # Both calls are in the storage request at the same time. When a call held the shared
          # test connection during its request, the other call could not read the photo.
          assert_receive {:head, first, false}, 2_000
          assert_receive {:head, second, false}, 2_000
          send(first, :continue)
          send(second, :continue)
          Task.await_many(tasks)
        end)

      assert [{:ok, %Photo{status: "processing"}}, {:ok, %Photo{status: "processing"}}] = result
      assert Repo.get!(Photo, photo.id).status == "processing"
      assert media_jobs(photo) == 1
      # The second call reads the new status in its transaction and does not change the photo.
      assert Enum.count(queries, &String.starts_with?(&1, ~s(UPDATE "photos"))) == 1
    end

    test "a photo that has moved on does not get a storage request", %{user: user, photo: photo} do
      Repo.update!(Ecto.Changeset.change(photo, status: "review"))
      assert {:ok, %Photo{status: "review"}} = Photos.complete(user, photo.id)
      refute_received {:head, _, _}
      assert media_jobs(photo) == 0
    end

    test "an incomplete upload and a foreign photo give their errors", %{user: user, photo: photo} do
      File.rm!(Storage.local_path(photo.source_key))
      assert {:error, :upload_incomplete} = Photos.complete(user, photo.id)
      assert Repo.get!(Photo, photo.id).status == "uploading"
      assert {:error, :not_found} = Photos.complete(user("stranger"), photo.id)
      assert {:error, :not_found} = Photos.complete(user, "not-an-id")
      assert media_jobs(photo) == 0
    end
  end

  describe "the gallery of a subject" do
    setup %{user: user, subject: subject} do
      other = user("other")
      now = StarsmapApi.Community.now()

      photos =
        for i <- 1..30 do
          author = if rem(i, 3) == 0, do: other, else: user
          # Photos 7 and 8 have the same publication time: the id decides their order.
          minutes = if i == 8, do: 7, else: i
          photo(author, subject, "published", DateTime.add(now, -minutes * 60))
        end

      # Photos that are not in the gallery.
      photo(user, subject, "review", nil)
      {:ok, mars} = Subjects.ensure("mars")
      photo(user, mars, "published", now)

      # Different weights: 1/k for the k-th vote of a voter for one author.
      [a, b, c] = for name <- ~w(voter-a voter-b voter-c), do: voter(name)
      vote(a, Enum.at(photos, 20))
      vote(a, Enum.at(photos, 4))
      vote(b, Enum.at(photos, 4))
      vote(b, Enum.at(photos, 2))
      vote(c, Enum.at(photos, 11))
      vote(c, Enum.at(photos, 25))

      {:ok, photos: photos}
    end

    test "gives the same pages as a sort of all the photos", %{subject: subject} do
      expected = reference_order(subject)
      assert length(expected) == 30

      first = Photos.gallery("moon") |> Enum.map(& &1.id)
      assert first == Enum.take(expected, 24)

      second = Photos.gallery("moon", List.last(first)) |> Enum.map(& &1.id)
      assert second == Enum.drop(expected, 24)

      # A cursor in the middle, the last photo, and unknown cursors.
      assert Photos.gallery("moon", Enum.at(expected, 9)) |> Enum.map(& &1.id) ==
               expected |> Enum.drop(10) |> Enum.take(24)

      assert Photos.gallery("moon", List.last(expected)) == []
      assert Photos.gallery("moon", Ecto.UUID.generate()) |> Enum.map(& &1.id) == first
      assert Photos.gallery("moon", "not-an-id") |> Enum.map(& &1.id) == first
      assert Photos.gallery("not-a-known-object") == []
    end

    test "reads one page of rows in a fixed number of queries" do
      {page, queries} = query_rows(fn -> Photos.gallery("moon") end)
      assert length(page) == 24
      # No query returns more rows than the page, although the subject has 30 photos.
      assert Enum.all?(queries, fn {_, rows} -> rows <= 24 end), inspect(queries)

      {small, small_queries} = query_rows(fn -> Photos.gallery("mars") end)
      assert length(small) == 1
      assert length(queries) == length(small_queries)
    end

    test "gives the same payloads as one photo at a time", %{photos: photos} do
      photo = Enum.at(photos, 4)

      Repo.insert_all("photo_subjects", [
        %{photo_id: Ecto.UUID.dump!(photo.id), key: "m1", name: "M1", x: 1.0, y: 2.0},
        %{photo_id: Ecto.UUID.dump!(photo.id), key: "m2", name: "M2", x: 3.0, y: 4.0}
      ])

      page = Photos.gallery("moon")
      payload = Enum.find(page, &(&1.id == photo.id))

      assert payload.votes == 2
      assert payload.author == %{handle: "author", name: "author"}

      assert payload.object_name ==
               Repo.get!(StarsmapApi.Community.Subject, photo.subject_id).name

      assert Enum.sort_by(payload.in_frame, & &1.key) |> Enum.map(& &1.key) == ["m1", "m2"]

      for item <- page do
        single = item.id |> Photos.get() |> Photos.public()
        assert single.votes == Ranking.vote_count(item.id)

        assert Map.update!(single, :in_frame, &Enum.sort_by(&1, fn a -> a.key end)) ==
                 Map.update!(item, :in_frame, &Enum.sort_by(&1, fn a -> a.key end))
      end
    end
  end

  test "the own photo list runs a fixed number of queries", %{user: user, subject: subject} do
    moderator = user("moderator")
    now = StarsmapApi.Community.now()
    rejected = photo(user, subject, "rejected", nil)
    published = photo(user, subject, "published", now)
    vote(voter("own-voter"), published)

    for {reason, seconds} <- [{"First reason", -60}, {"Last reason", 0}] do
      Repo.insert!(%Action{
        photo_id: rejected.id,
        user_id: moderator.id,
        action: "reject",
        reason: reason,
        inserted_at: DateTime.add(now, seconds)
      })
    end

    {mine, small} = queries(fn -> Photos.mine(user) end)

    assert %{moderation_reason: "Last reason", votes: 0} =
             Enum.find(mine, &(&1.id == rejected.id))

    assert %{moderation_reason: nil, votes: 1} = Enum.find(mine, &(&1.id == published.id))
    assert Enum.all?(mine, &(&1.object_name == subject.name))

    for _ <- 1..10, do: photo(user, subject, "published", now)
    {mine, large} = queries(fn -> Photos.mine(user) end)
    assert length(mine) == 12
    assert length(large) == length(small)
  end

  test "the author list has its limit in the query", %{user: user, subject: subject} do
    now = StarsmapApi.Community.now()
    for i <- 1..30, do: photo(user, subject, "published", DateTime.add(now, -i))

    {photos, [query]} = queries(fn -> Photos.by_author(user.id, 24) end)
    assert length(photos) == 24
    assert query =~ "LIMIT"
    assert photos == Photos.by_author(user.id) |> Enum.take(24)

    dates = Enum.map(photos, & &1.published_at)
    assert dates == Enum.sort(dates, {:desc, DateTime})
  end

  describe "with a solver that hangs" do
    setup %{user: user, subject: subject} do
      root = Application.fetch_env!(:starsmap_api, :community_backend_root)
      fixture = Path.join(System.tmp_dir!(), "hung-solver-#{Ecto.UUID.generate()}")
      pids = Path.join(fixture, "pids")
      File.mkdir_p!(fixture)

      File.write!(Path.join(fixture, "community_solve.py"), """
      import os, subprocess, time
      child = subprocess.Popen(['sleep', '60'])
      with open(#{inspect(pids)}, 'w') as file:
          file.write(f'{os.getpid()} {child.pid}')
      time.sleep(60)
      """)

      Application.put_env(:starsmap_api, :community_backend_root, fixture)
      Application.put_env(:starsmap_api, :community_solve_limit_seconds, 1)

      photo = photo(user, subject, "review", nil)
      master = Storage.local_path("masters/#{photo.id}/1600.webp")
      File.mkdir_p!(Path.dirname(master))
      File.write!(master, "webp")

      on_exit(fn ->
        Application.put_env(:starsmap_api, :community_backend_root, root)
        Application.delete_env(:starsmap_api, :community_solve_limit_seconds)
        File.rm_rf(fixture)
        File.rm_rf(Path.dirname(master))
      end)

      {:ok, photo: photo, pids: pids}
    end

    test "the job ends at the limit, for a retry, and the solver and scratch files are gone", %{
      photo: photo,
      pids: pids
    } do
      started = System.monotonic_time(:second)

      assert {:error, :solver_timeout} =
               SolverWorker.perform(%Oban.Job{args: %{"id" => photo.id}})

      assert System.monotonic_time(:second) - started < 10
      assert Path.wildcard(Path.join(Storage.root(), "solve-#{photo.id}-*")) == []

      [python, sleep] = pids |> File.read!() |> String.split()
      assert stopped?(python)
      assert stopped?(sleep)
      assert Repo.get!(Photo, photo.id).wcs == nil
    end
  end

  test "a storage read failure retries the solver job", %{user: user, subject: subject} do
    storage = Application.fetch_env!(:starsmap_api, :community_storage)
    Application.put_env(:starsmap_api, :community_storage, FailingStorage)
    on_exit(fn -> Application.put_env(:starsmap_api, :community_storage, storage) end)
    photo = photo(user, subject, "review", nil)

    assert {:error, :timeout} = SolverWorker.perform(%Oban.Job{args: %{"id" => photo.id}})
    assert Path.wildcard(Path.join(Storage.root(), "solve-#{photo.id}-*")) == []
  end

  test "an unsolved image still cancels the solver job", %{user: user, subject: subject} do
    root = Application.fetch_env!(:starsmap_api, :community_backend_root)
    fixture = Path.join(System.tmp_dir!(), "unsolved-image-#{Ecto.UUID.generate()}")
    File.mkdir_p!(fixture)
    File.write!(Path.join(fixture, "community_solve.py"), "import sys\nsys.exit(1)\n")
    Application.put_env(:starsmap_api, :community_backend_root, fixture)
    photo = photo(user, subject, "review", nil)
    master = Storage.local_path("masters/#{photo.id}/1600.webp")
    File.mkdir_p!(Path.dirname(master))
    File.write!(master, "webp")

    on_exit(fn ->
      Application.put_env(:starsmap_api, :community_backend_root, root)
      File.rm_rf(fixture)
      File.rm_rf(Path.dirname(master))
    end)

    assert {:cancel, "No supported plate solution was found"} =
             SolverWorker.perform(%Oban.Job{args: %{"id" => photo.id}})
  end

  test "a photo deleted while its solve finishes ends the job cleanly", %{
    user: user,
    subject: subject
  } do
    root = Application.fetch_env!(:starsmap_api, :community_backend_root)
    fixture = Path.join(System.tmp_dir!(), "finished-solver-#{Ecto.UUID.generate()}")
    started = Path.join(fixture, "started")
    continue = Path.join(fixture, "continue")
    File.mkdir_p!(fixture)

    File.write!(Path.join(fixture, "community_solve.py"), """
    import json, pathlib, time
    pathlib.Path(#{inspect(started)}).touch()
    deadline = time.monotonic() + 5
    while not pathlib.Path(#{inspect(continue)}).exists():
        if time.monotonic() > deadline:
            raise SystemExit('test did not release the solver')
        time.sleep(0.01)
    print(json.dumps({'ra_deg': 83.8, 'dec_deg': -5.4, 'pixel_scale_arcsec': 2.0, 'rotation_deg': 0.0, 'width': 1600, 'height': 1200, 'cd': [-0.001, 0.0, 0.0, 0.001], 'crpix': [800.5, 600.5]}))
    """)

    Application.put_env(:starsmap_api, :community_backend_root, fixture)
    photo = photo(user, subject, "review", nil)
    master = Storage.local_path("masters/#{photo.id}/1600.webp")
    File.mkdir_p!(Path.dirname(master))
    File.write!(master, "webp")

    on_exit(fn ->
      File.touch(continue)
      Application.put_env(:starsmap_api, :community_backend_root, root)
      File.rm_rf(fixture)
      File.rm_rf(Path.dirname(master))
    end)

    task = Task.async(fn -> SolverWorker.perform(%Oban.Job{args: %{"id" => photo.id}}) end)
    assert :ok = await_file(started)
    Repo.delete!(photo)
    File.touch!(continue)
    assert :ok = Task.await(task)
    assert Repo.get(Photo, photo.id) == nil
    assert Path.wildcard(Path.join(Storage.root(), "solve-#{photo.id}-*")) == []
  end

  test "the Oban timeout of the solver job comes after the command limit" do
    assert SolverWorker.timeout(%Oban.Job{}) > :timer.seconds(90 + 5)
  end

  defp await_file(path, tries \\ 500)
  defp await_file(path, 0), do: flunk("Timed out waiting for #{path}")

  defp await_file(path, tries) do
    if File.exists?(path) do
      :ok
    else
      Process.sleep(10)
      await_file(path, tries - 1)
    end
  end

  # The order of the gallery before the database sorted it: all the photos, sorted in Elixir.
  defp reference_order(subject) do
    scores = Ranking.scores()

    Repo.all(
      from [p, _] in Photos.published(),
        where: p.subject_id == ^subject.id,
        select: {p.id, p.published_at}
    )
    |> Enum.sort_by(fn {id, at} ->
      {-Map.get(scores, id, %{score: 0.0}).score, DateTime.to_unix(at, :microsecond), id}
    end)
    |> Enum.map(&elem(&1, 0))
  end

  defp user(handle) do
    Repo.insert!(%User{
      email: "#{handle}@example.com",
      handle: handle,
      name: handle,
      inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
    })
  end

  defp voter(handle) do
    Repo.insert!(%User{
      email: "#{handle}@example.com",
      handle: handle,
      name: handle,
      inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800),
      first_sign_in_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
    })
  end

  defp vote(voter, photo), do: {:ok, _} = Ranking.vote(voter, photo.id, true)

  defp photo(user, subject, status, published_at) do
    Repo.insert!(%Photo{
      user_id: user.id,
      subject_id: subject.id,
      declared_key: "moon",
      title: "Test photo",
      caption: "",
      licence: "All rights reserved",
      captured_at: StarsmapApi.Community.now(),
      status: status,
      source_key: "uploads/#{Ecto.UUID.generate()}",
      size_bytes: 100,
      published_at: published_at
    })
  end

  defp uploaded_photo(user) do
    bytes = "uploaded bytes"

    {:ok, photo} =
      Photos.create(user, %{
        "key" => "moon",
        "size_bytes" => byte_size(bytes),
        "title" => "Moon fixture",
        "licence" => "All rights reserved",
        "captured_at" => "2026-10-08T00:00:00Z",
        "rights_confirmed" => true
      })

    path = Storage.local_path(photo.source_key)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, bytes)
    on_exit(fn -> File.rm(path) end)
    photo
  end

  defp media_jobs(photo) do
    Repo.aggregate(
      from(j in Oban.Job,
        where: j.worker == ^inspect(MediaWorker) and fragment("?->>'id' = ?", j.args, ^photo.id)
      ),
      :count
    )
  end

  # A stopped orphan stays a zombie until PID 1 collects it. A zombie does not run.
  defp stopped?(pid, tries \\ 40) do
    case System.cmd("ps", ["-o", "stat=", "-p", pid]) do
      {stat, 0} ->
        cond do
          String.starts_with?(String.trim(stat), "Z") -> true
          tries > 0 -> Process.sleep(50) && stopped?(pid, tries - 1)
          true -> false
        end

      _ ->
        true
    end
  end

  # The SQL text of each query of the community database while `action` runs.
  defp queries(action) do
    {result, rows} = query_rows(action)
    {result, Enum.map(rows, &elem(&1, 0))}
  end

  # The SQL text and the row count of each query of the community database while `action` runs.
  defp query_rows(action) do
    handler = "community-performance-queries-#{System.unique_integer([:positive])}"

    :telemetry.attach(
      handler,
      [:starsmap_api, :community_repo, :query],
      &__MODULE__.query_event/4,
      self()
    )

    try do
      result = action.()
      {result, received([])}
    after
      :telemetry.detach(handler)
    end
  end

  def query_event(_event, _measurements, metadata, pid) do
    rows =
      case metadata.result do
        {:ok, %{num_rows: rows}} -> rows
        _ -> 0
      end

    send(pid, {:community_query, metadata.query, rows})
  end

  defp received(queries) do
    receive do
      {:community_query, query, rows} -> received([{query, rows} | queries])
    after
      0 -> Enum.reverse(queries)
    end
  end
end
