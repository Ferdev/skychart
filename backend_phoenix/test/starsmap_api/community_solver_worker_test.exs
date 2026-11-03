defmodule StarsmapApi.CommunitySolverWorkerTest do
  @moduledoc "The plate-solver worker with a stand-in solve script: retry or cancel."
  use ExUnit.Case, async: false

  alias StarsmapApi.Community.{Photo, SolverWorker, Storage, Subjects, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  setup do
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(Repo)
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok = Ecto.Adapters.SQL.Sandbox.checkout(StarsmapApi.Repo)
    Ecto.Adapters.SQL.Sandbox.mode(StarsmapApi.Repo, {:shared, self()})

    # The worker runs `community_solve.py` from the backend root, so the test puts its own there.
    backend = Path.join(System.tmp_dir!(), "solver-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(backend)
    previous = Application.get_env(:starsmap_api, :community_backend_root)
    Application.put_env(:starsmap_api, :community_backend_root, backend)

    author = Repo.insert!(%User{email: "solver@example.com", handle: "solver", name: "Solver"})
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
        status: "review"
      })

    master = Path.join(Storage.root(), "masters/#{photo.id}")

    on_exit(fn ->
      Application.put_env(:starsmap_api, :community_backend_root, previous)
      File.rm_rf(backend)
      File.rm_rf(master)
    end)

    {:ok, photo: photo, backend: backend, master: master}
  end

  defp script(context, body) do
    File.write!(Path.join(context.backend, "community_solve.py"), body)
    File.mkdir_p!(context.master)
    File.write!(Path.join(context.master, "1600.webp"), "image")
  end

  defp perform(photo), do: SolverWorker.perform(%Oban.Job{args: %{"id" => photo.id}})

  test "a storage failure is an error, so the job runs again", context do
    script(context, "raise SystemExit('the script must not run')\n")
    File.rm_rf!(context.master)

    assert {:error, {:storage, _}} = perform(context.photo)
    assert Repo.get!(Photo, context.photo.id).wcs == nil
  end

  test "a solver that stops without its result is an error, so the job runs again", context do
    script(context, "import sys\nsys.exit(137)\n")

    assert {:error, {:solver_exit, 137}} = perform(context.photo)
  end

  test "an image without a solution cancels the job", context do
    script(context, """
    import json, sys
    print(json.dumps({'error': 'No supported plate solution was found'}))
    sys.exit(1)
    """)

    assert {:cancel, "No supported plate solution was found"} = perform(context.photo)
    assert Repo.get!(Photo, context.photo.id).wcs == nil
  end

  test "a solution that is not valid cancels the job", context do
    script(context, "import json\nprint(json.dumps({'ra_deg': 400}))\n")

    assert {:cancel, "No supported plate solution was found"} = perform(context.photo)
  end

  test "a valid solution is stored on the photo", context do
    script(context, """
    import json
    print(json.dumps({'ra_deg': 150.0, 'dec_deg': 2.0, 'pixel_scale_arcsec': 2.0,
      'rotation_deg': 0.0, 'width': 96, 'height': 96,
      'cd': [-0.000556, 0.0, 0.0, 0.000556], 'crpix': [48.5, 48.5]}))
    """)

    assert :ok = perform(context.photo)
    wcs = Repo.get!(Photo, context.photo.id).wcs
    assert wcs["status"] == "solved"
    assert wcs["source"] == "Astrometry.net"
    assert wcs["crpix"] == [48.5, 48.5]
  end
end
