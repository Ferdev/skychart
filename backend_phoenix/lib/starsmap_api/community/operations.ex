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

  @catalogs ["messier", "ngc", "ic"]

  @doc """
  Deep-sky objects that have no community photo, with the totals of each catalog.

  `catalog` is `messier`, `ngc`, `ic`, or nil for all. `query` is a text that the name, an
  alias, or the constellation must contain. The list has 200 objects at most.
  """
  def coverage(catalog \\ nil, query \\ nil) do
    counts =
      Repo.all(from s in "subject_photo_stats", select: s.payload)
      |> Enum.reduce(%{}, fn p, map ->
        Enum.reduce(p["keys"], map, &Map.put(&2, &1, p["count"]))
      end)

    entries = Enum.map(catalog_entries(), &Map.put(&1, :count, Map.get(counts, &1.key, 0)))

    totals =
      Map.new(@catalogs, fn name ->
        group = Enum.filter(entries, &(&1.catalog == name))
        {name, %{total: length(group), covered: Enum.count(group, &(&1.count > 0))}}
      end)

    needle = if is_binary(query), do: query |> String.trim() |> String.downcase(), else: ""

    missing =
      entries
      |> Enum.filter(fn entry ->
        entry.count == 0 and (catalog not in @catalogs or entry.catalog == catalog) and
          (needle == "" or String.contains?(entry.search, needle))
      end)

    %{
      total: length(entries),
      covered: Enum.count(entries, &(&1.count > 0)),
      catalogs: totals,
      matched: length(missing),
      objects: missing |> Enum.take(200) |> Enum.map(&Map.drop(&1, [:search, :count]))
    }
  end

  # The catalog files do not change while the release runs, so one decode is sufficient.
  defp catalog_entries do
    root = Application.get_env(:starsmap_api, :community_catalog_root, "/app/data/catalogs")

    case :persistent_term.get({__MODULE__, :catalog, root}, nil) do
      nil ->
        entries =
          [{"deep_sky_catalog.json", "messier"}, {"ngc_ic_deep_sky.json", nil}]
          |> Enum.flat_map(fn {file, catalog} ->
            data = Jason.decode!(File.read!(Path.join(root, file)))
            Enum.map(data["objects"] || [], &catalog_entry(&1, catalog))
          end)

        # The brightest objects come first: they are the easiest targets.
        entries = Enum.sort_by(entries, &{is_nil(&1.magnitude), &1.magnitude, &1.name})
        :persistent_term.put({__MODULE__, :catalog, root}, entries)
        entries

      entries ->
        entries
    end
  end

  defp catalog_entry(object, catalog) do
    key = object["key"]

    %{
      key: key,
      name: object["name"],
      catalog: catalog || if(String.starts_with?(key, "ic"), do: "ic", else: "ngc"),
      type: object["deep_sky_type_label"],
      constellation: object["constellation"],
      magnitude: object["apparent_magnitude"],
      search:
        [object["name"], object["constellation"] | object["aliases"] || []]
        |> Enum.filter(&is_binary/1)
        |> Enum.join(" ")
        |> String.downcase()
    }
  end
end
