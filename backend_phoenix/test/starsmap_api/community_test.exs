defmodule StarsmapApi.CommunityTest do
  use ExUnit.Case, async: false
  import Ecto.Query

  alias StarsmapApi.Community.{
    Accounts,
    User,
    Photo,
    Photos,
    Subjects,
    Moderation,
    Ranking,
    Storage
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)
    Application.put_env(:starsmap_api, :community_test_mail_pid, self())
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_test_mail_pid) end)

    user =
      Repo.insert!(%User{
        email: "author@example.com",
        handle: "author",
        name: "Author",
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      })

    {:ok, subject} = Subjects.ensure("moon")
    {:ok, user: user, subject: subject}
  end

  test "email codes are one-time and wrong attempts persist" do
    assert :ok = Accounts.request_code("reader@example.com")
    assert_receive {:community_code, "reader@example.com", code}
    assert {:error, :invalid_code} = Accounts.verify("reader@example.com", "wrong")
    assert {:ok, token, user} = Accounts.verify("reader@example.com", code)
    assert Accounts.authenticate(token).id == user.id
    assert {:error, :invalid_code} = Accounts.verify("reader@example.com", code)
    Accounts.logout(token)
    refute Accounts.authenticate(token)
  end

  test "five attempts disable the code, and expiry is checked" do
    :ok = Accounts.request_code("attempts@example.com")
    assert_receive {:community_code, _, code}

    for _ <- 1..5,
        do: assert({:error, :invalid_code} = Accounts.verify("attempts@example.com", "bad"))

    assert {:error, :invalid_code} = Accounts.verify("attempts@example.com", code)
  end

  test "identity has source-backed Messier counterparts and preserves spaces" do
    assert "ngc-224" in Subjects.keys("m31")
    assert "local-volume-andromeda" in Subjects.keys("m31")
    assert Subjects.keys("ngc-foo bar") == ["ngc-foo bar"]
    assert {:error, :invalid_subject} = Subjects.ensure("catalog-tile-preview:any")
  end

  test "private photos do not enter galleries or the cover index", %{user: user, subject: subject} do
    photo = photo(user, subject, "review")
    assert Photos.gallery("moon") == []
    refute Photos.visible?(photo)
    StarsmapApi.Community.transaction(fn -> Ranking.refresh(subject.id) end)
    assert [%{"cover" => nil, "count" => 0}] = Ranking.index(0).items
  end

  test "approval and hiding emit an index removal and audit", %{user: user, subject: subject} do
    moderator =
      Repo.insert!(%User{
        email: "mod@example.com",
        handle: "moderator",
        name: "Moderator",
        role: "moderator"
      })

    photo = photo(user, subject, "review")
    assert {:error, :not_allowed} = Moderation.review(user, photo.id, "approve", "Looks correct")
    assert {:ok, published} = Moderation.review(moderator, photo.id, "approve", "Rights reviewed")
    assert Photos.visible?(published)
    index = Ranking.index(0)
    assert [%{"count" => 1}] = index.items
    assert {:ok, _} = Moderation.review(moderator, photo.id, "hide", "Reported attribution")
    assert Photos.gallery("moon") == []
    assert [%{"cover" => nil, "count" => 0}] = Ranking.index(index.version).items
    assert Repo.aggregate(StarsmapApi.Community.Action, :count) == 2
  end

  test "duplicate votes count once; self votes and young accounts fail", %{
    user: user,
    subject: subject
  } do
    photo = photo(user, subject, "published")
    assert {:error, :vote_not_allowed} = Ranking.vote(user, photo.id, true)

    voter =
      Repo.insert!(%User{
        email: "voter@example.com",
        handle: "voter",
        name: "Voter",
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      })

    assert {:ok, %{votes: 1}} = Ranking.vote(voter, photo.id, true)
    assert {:ok, %{votes: 1}} = Ranking.vote(voter, photo.id, true)
    assert {:ok, %{votes: 0}} = Ranking.vote(voter, photo.id, false)
    young = Repo.insert!(%User{email: "young@example.com", handle: "young", name: "Young"})
    assert {:error, :account_too_new} = Ranking.vote(young, photo.id, true)
  end

  test "real image processing creates stripped derivatives and requires initial review", %{
    user: user
  } do
    source = Path.join(Storage.root(), "test-source-#{Ecto.UUID.generate()}.png")
    File.mkdir_p!(Path.dirname(source))
    {_, 0} = System.cmd("vips", ["black", source, "64", "32", "--bands", "3"])

    {:ok, photo} =
      Photos.create(user, %{
        "key" => "moon",
        "size_bytes" => File.stat!(source).size,
        "title" => "Moon fixture",
        "licence" => "All rights reserved",
        "captured_at" => "2026-10-08T00:00:00Z",
        "rights_confirmed" => true
      })

    :ok = Storage.Local.put(photo.source_key, source, false)
    assert {:ok, processing} = Photos.complete(user, photo.id)
    assert processing.status == "processing"
    assert :ok = StarsmapApi.Community.MediaWorker.process(processing)
    processed = Photos.get(photo.id)
    assert processed.status == "review"
    assert processed.sha256
    assert processed.assets["perceptual_hash"] =~ ~r/^[0-9a-f]{16}$/
    assert processed.assets["dominant_color"] =~ ~r/^#[0-9a-f]{6}$/
    assert processed.assets["width"] == 64
    assert processed.assets["height"] == 32
    assert File.regular?(Storage.local_path("masters/#{photo.id}/320.webp"))
    refute Photos.visible?(processed)
    File.rm(source)
  end

  test "media and solver scripts resolve inside this checkout" do
    for script <- ["community_media.py", "community_solve.py"] do
      path = StarsmapApi.Community.backend_script(script)
      assert Path.dirname(path) == Path.expand("../../../backend", __DIR__)
      assert File.regular?(path)
    end
  end

  test "fourth approved-author photo publishes through a durable job", %{
    user: user,
    subject: subject
  } do
    for _ <- 1..3, do: photo(user, subject, "published")
    source = Path.join(Storage.root(), "auto-source-#{Ecto.UUID.generate()}.png")
    File.mkdir_p!(Path.dirname(source))
    {_, 0} = System.cmd("vips", ["black", source, "16", "16", "--bands", "3"])

    {:ok, p} =
      Photos.create(user, %{
        "key" => "moon",
        "size_bytes" => File.stat!(source).size,
        "title" => "Fourth photo",
        "licence" => "CC BY 4.0",
        "captured_at" => "2026-10-08T00:00:00Z",
        "rights_confirmed" => true
      })

    :ok = Storage.Local.put(p.source_key, source, false)
    {:ok, p} = Photos.complete(user, p.id)
    assert :ok = StarsmapApi.Community.MediaWorker.process(p)
    assert Photos.visible?(Photos.get(p.id))

    assert Repo.exists?(
             from j in Oban.Job, where: j.worker == "StarsmapApi.Community.PublishWorker"
           )

    File.rm(source)
  end

  test "rank snapshots preserve first-photo credit and author removals cannot be restored", %{
    user: user,
    subject: subject
  } do
    p = photo(user, subject, "published")
    StarsmapApi.Community.transaction(fn -> Ranking.refresh(subject.id) end)
    assert hd(Ranking.photographers()).first_photos == 1
    assert hd(Ranking.photographers()).covers == 1
    assert :ok = StarsmapApi.Community.RankingWorker.perform(%Oban.Job{})
    assert Repo.aggregate("ranking_snapshots", :count) == 3
    assert {:ok, :ok} = Moderation.remove(user, p.id)

    mod =
      Repo.insert!(%User{
        email: "mod-removed@example.com",
        handle: "mod-removed",
        name: "Moderator",
        role: "moderator"
      })

    assert {:error, :not_allowed} =
             Moderation.review(mod, p.id, "restore", "Cannot restore author removals")

    assert Ranking.photographers() == []
  end

  test "disposable mail domains are blocked before an account is created" do
    assert {:error, :invalid_email} = Accounts.request_code("reader@mailinator.com")
    refute Repo.get_by(User, email: "reader@mailinator.com")
  end

  test "S3 upload signatures bind the reserved size and prevent replacement", %{
    user: user,
    subject: subject
  } do
    original = Application.get_all_env(:ex_aws)
    original_bucket = Application.get_env(:starsmap_api, :community_s3_bucket)

    on_exit(fn ->
      for {key, _} <- Application.get_all_env(:ex_aws), do: Application.delete_env(:ex_aws, key)
      for {key, value} <- original, do: Application.put_env(:ex_aws, key, value)
      Application.put_env(:starsmap_api, :community_s3_bucket, original_bucket)
    end)

    Application.put_env(:ex_aws, :access_key_id, "local-test-key")
    Application.put_env(:ex_aws, :secret_access_key, "local-test-secret")
    Application.put_env(:ex_aws, :region, "us-east-1")
    Application.put_env(:starsmap_api, :community_s3_bucket, "local-test-bucket")
    p = photo(user, subject, "uploading")
    assert {:ok, intent} = Storage.S3.intent(p)
    assert intent.headers == %{"if-none-match" => "*"}
    query = URI.decode_query(URI.parse(intent.url).query)
    assert query["X-Amz-SignedHeaders"] == "content-length;host;if-none-match"
    assert query["X-Amz-Expires"] == "900"
  end

  test "upload metadata rejects oversized files and absent rights", %{user: user} do
    assert {:error, _} =
             Photos.create(user, %{
               "key" => "moon",
               "size_bytes" => 60_000_001,
               "rights_confirmed" => true
             })

    assert {:error, _} =
             Photos.create(user, %{
               "key" => "moon",
               "size_bytes" => 1,
               "rights_confirmed" => false
             })
  end

  test "vote weights, trend threshold and cover changes are deterministic", %{
    user: user,
    subject: subject
  } do
    first = photo(user, subject, "published")
    second = photo(user, subject, "published")

    voter =
      Repo.insert!(%User{
        email: "weighted@example.com",
        handle: "weighted",
        name: "Weighted",
        inserted_at: DateTime.add(StarsmapApi.Community.now(), -172_800)
      })

    assert {:ok, _} = Ranking.vote(voter, first.id, true)
    assert {:ok, _} = Ranking.vote(voter, second.id, true)
    assert_in_delta Ranking.scores()[first.id].score, 1.0, 0.0001
    assert_in_delta Ranking.scores()[second.id].score, 0.5, 0.0001
    assert Ranking.scores()[second.id].trend == 0
    assert {:ok, _} = Ranking.vote(voter, first.id, false)
    assert_in_delta Ranking.scores()[second.id].score, 1.0, 0.0001
    assert [%{"cover" => %{"id" => id}}] = Ranking.index(0).items
    assert id == second.id
    assert hd(Photos.gallery("moon")).id == second.id
  end

  test "reports are resolved by audited moderation and suspension removes public covers", %{
    user: user,
    subject: subject
  } do
    moderator =
      Repo.insert!(%User{
        email: "reviewer@example.com",
        handle: "reviewer",
        name: "Reviewer",
        role: "moderator"
      })

    photo = photo(user, subject, "published")
    assert {:ok, _} = Moderation.report(photo.id, "Attribution needs review")
    assert length(Moderation.reports()) == 1
    assert {:error, :not_allowed} = Moderation.suspend(user, user.handle, "Abuse review", true)
    assert {:ok, _} = Moderation.review(moderator, photo.id, "hide", "Attribution review")
    assert Moderation.reports() == []
    assert {:ok, _} = Moderation.review(moderator, photo.id, "restore", "Permission confirmed")
    assert {:ok, _} = Moderation.suspend(moderator, user.handle, "Repeated abuse", true)
    assert Photos.gallery("moon") == []
    assert [%{"cover" => nil}] = Ranking.index(0).items
  end

  test "account deletion revokes login, hides photos and queues byte removal", %{
    user: user,
    subject: subject
  } do
    p = photo(user, subject, "published")
    assert {:ok, :ok} = StarsmapApi.Community.Privacy.erase(user)
    assert Repo.get!(User, user.id).suspended
    refute Photos.visible?(Photos.get(p.id))
    assert Photos.gallery("moon") == []
    assert Repo.get!(User, user.id).email != user.email

    assert Repo.exists?(
             Ecto.Query.from(j in Oban.Job,
               where: j.worker == "StarsmapApi.Community.PurgeWorker"
             )
           )
  end

  test "TAN image annotations preserve reference pixels and parity" do
    w = %{
      "ra_deg" => 0,
      "dec_deg" => 0,
      "width" => 100,
      "height" => 80,
      "pixel_scale_arcsec" => 3.6,
      "rotation_deg" => 0
    }

    {x, y} = StarsmapApi.Community.Annotations.pixel(w, 0, 0)
    assert_in_delta x, 0.5, 0.000001
    assert_in_delta y, 0.5, 0.000001

    {x, y} =
      StarsmapApi.Community.Annotations.pixel(
        Map.merge(w, %{"cd" => [-0.001, 0, 0, 0.001], "crpix" => [25.5, 20.5]}),
        0,
        0
      )

    assert_in_delta x, 0.25, 0.000001
    assert_in_delta y, 0.75, 0.000001
    assert is_nil(StarsmapApi.Community.Annotations.pixel(w, 180, 0))

    assert {:error, :invalid_wcs} =
             StarsmapApi.Community.Astrometry.validate(Map.put(w, "width", 200_000_000))
  end

  defp photo(user, subject, status) do
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
      published_at: if(status == "published", do: StarsmapApi.Community.now(), else: nil)
    })
  end
end
