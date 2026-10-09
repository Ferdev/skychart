defmodule StarsmapApi.Community.Operations do
  @moduledoc "Operator commands for role grants and permission-reviewed seed photos."
  import Ecto.Query
  alias StarsmapApi.Community.{User, Photos, MediaWorker, Moderation, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  def role(handle, role) when role in ["admin", "moderator", "member"] do
    user = Repo.get_by!(User, handle: handle)
    Repo.update!(Ecto.Changeset.change(user, role: role))
    :ok
  end

  # Input records use the same rights checks, quotas, decoder and review path.
  # No image or rights declaration is invented by this importer.
  def import_manifest(path, moderator_handle) do
    moderator = Repo.get_by!(User, handle: moderator_handle, suspended: false)

    if moderator.role not in ["admin", "moderator"],
      do: raise("A moderator must approve seed photos")

    records = path |> File.read!() |> Jason.decode!()

    if not is_list(records) or length(records) > 100,
      do: raise("Import at most 100 photos per manifest")

    Enum.map(records, fn record ->
      source = Path.expand(record["file"], Path.dirname(path))
      user = Repo.get_by!(User, handle: record["author_handle"], suspended: false)
      attrs = Map.put(record, "size_bytes", File.stat!(source).size)
      {:ok, photo} = Photos.create(user, attrs)
      # Storage access is scoped to this generated photo key.
      :ok = Storage.adapter().put(photo.source_key, source, false)
      {:ok, photo} = Photos.complete(user, photo.id)
      :ok = MediaWorker.perform(%Oban.Job{args: %{"id" => photo.id}})

      {:ok, _} =
        Moderation.review(moderator, photo.id, "approve", "Permission reviewed in seed manifest")

      :ok = Moderation.publish_files(Photos.get(photo.id))
      photo.id
    end)
  end

  def coverage do
    entries =
      ["deep_sky_catalog.json", "ngc_ic_deep_sky.json"]
      |> Enum.flat_map(fn file ->
        data =
          Jason.decode!(
            File.read!(
              Path.join(
                Application.get_env(:starsmap_api, :community_catalog_root, "/app/data/catalogs"),
                file
              )
            )
          )

        data["objects"] || []
      end)

    counts =
      Repo.all(from s in "subject_photo_stats", select: s.payload)
      |> Enum.reduce(%{}, fn p, map ->
        Enum.reduce(p["keys"], map, &Map.put(&2, &1, p["count"]))
      end)

    entries
    |> Enum.map(fn p -> %{key: p["key"], name: p["name"], count: Map.get(counts, p["key"], 0)} end)
    |> Enum.filter(&(&1.count == 0))
    |> Enum.take(1000)
  end
end
