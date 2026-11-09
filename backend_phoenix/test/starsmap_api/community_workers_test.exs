defmodule StarsmapApi.CommunityWorkersTest do
  @moduledoc "The depth and sweep workers with the real scripts and real files in local storage."
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.{
    Depth,
    DepthWorker,
    Finding,
    Photo,
    Storage,
    Subjects,
    SweepWorker,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  @wcs %{
    "status" => "solved",
    "frame" => "ICRS",
    "epoch" => "J2000",
    "projection" => "TAN",
    "ra_deg" => 150.0,
    "dec_deg" => 2.0,
    "pixel_scale_arcsec" => 2.0,
    "rotation_deg" => 0.0,
    "width" => 96,
    "height" => 96
  }

  defmodule Sources do
    @behaviour StarsmapApi.Community.SkySources
    def small_bodies(_time, lat, lon, _ra, _dec, _half) do
      send(self(), {:site, lat, lon})
      {:ok, [%{name: "(433) Eros", ra: 150.0, dec: 2.0, magnitude: 12.0}]}
    end

    def dr11(_, _, _), do: :error
    def transients(_, _, _), do: {:ok, []}
  end

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)
    Ecto.Adapters.SQL.Sandbox.mode(StarsmapApi.Repo, {:shared, self()})
    Application.put_env(:starsmap_api, :community_sky_sources, Sources)
    on_exit(fn -> Application.delete_env(:starsmap_api, :community_sky_sources) end)
    author = Repo.insert!(%User{email: "a@example.com", handle: "author", name: "Author"})
    {:ok, subject} = Subjects.ensure("moon")

    photo =
      Repo.insert!(%Photo{
        user_id: author.id,
        subject_id: subject.id,
        declared_key: "moon",
        title: "Field",
        captured_at: ~U[2026-10-30 22:00:00.000000Z],
        licence: "CC BY 4.0",
        source_key: "uploads/x",
        size_bytes: 1,
        status: "published",
        depth_allowed: true,
        wcs: @wcs,
        site_lat: 40.0,
        site_lon: -3.0,
        published_at: StarsmapApi.Community.now()
      })

    # A small gray PNG. Vips writes it, so the test uses the same decoder as the worker.
    dir = Path.join(Storage.root(), "masters/#{photo.id}")
    File.mkdir_p!(dir)
    {_, 0} = System.cmd("vips", ["black", Path.join(dir, "black.png"), "96", "96"])

    {_, 0} =
      System.cmd("vips", ["copy", Path.join(dir, "black.png"), Path.join(dir, "master.png")])

    {_, 0} =
      System.cmd("vips", ["copy", Path.join(dir, "black.png"), Path.join(dir, "1600.webp")])

    on_exit(fn -> File.rm_rf(dir) end)
    {:ok, photo: photo}
  end

  test "the sweep keeps a known body and makes no candidate without the survey", %{photo: photo} do
    assert :ok = SweepWorker.perform(%Oban.Job{args: %{"id" => photo.id}})
    assert_received {:site, 40.0, -3.0}

    assert [%Finding{kind: "known_body", designation: "(433) Eros", state: "proposed"}] =
             Repo.all(Finding)

    assert Repo.get!(Photo, photo.id).assets["sweep"]["stop"] == "no_survey"
  end

  defmodule FailingGet do
    @moduledoc "Local storage with a read that fails, as a network store can fail for a moment."
    def get(_key, _path), do: {:error, :timeout}
  end

  test "a storage read failure retries the depth job", %{photo: photo} do
    storage = Application.fetch_env!(:starsmap_api, :community_storage)
    Application.put_env(:starsmap_api, :community_storage, FailingGet)
    on_exit(fn -> Application.put_env(:starsmap_api, :community_storage, storage) end)

    assert {:error, :timeout} = DepthWorker.perform(%Oban.Job{args: %{"id" => photo.id}})
  end

  test "a depth script that runs out of time retries, and bad output cancels", %{photo: photo} do
    root = Path.join(System.tmp_dir!(), "depth-script-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    backend = Application.get_env(:starsmap_api, :community_backend_root)
    Application.put_env(:starsmap_api, :community_backend_root, root)

    on_exit(fn ->
      if backend,
        do: Application.put_env(:starsmap_api, :community_backend_root, backend),
        else: Application.delete_env(:starsmap_api, :community_backend_root)

      File.rm_rf(root)
    end)

    script = Path.join(root, "community_depth.py")
    File.write!(script, "import sys\nsys.exit(124)\n")
    assert {:error, :depth_timeout} = DepthWorker.perform(%Oban.Job{args: %{"id" => photo.id}})

    File.write!(script, "print('not json')\n")
    assert {:cancel, _} = DepthWorker.perform(%Oban.Job{args: %{"id" => photo.id}})
  end

  test "the depth worker runs its script and an empty field gives no layers", %{photo: photo} do
    assert :ok = DepthWorker.perform(%Oban.Job{args: %{"id" => photo.id}})
    refute Depth.ready?(photo)
  end
end
