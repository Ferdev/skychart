defmodule StarsmapApi.Community.PhotoDepthLayer do
  use Ecto.Schema
  @primary_key {:photo_id, Ecto.UUID, autogenerate: false}
  schema "photo_depth_layers" do
    field :plane_distance_ly, :float
    field :width, :integer
    field :height, :integer
    field :cell, :integer
    field :detected, :integer
    field :sources, :map
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule StarsmapApi.Community.Depth do
  @moduledoc """
  Depth layers of a published solved photo: its matched stars and galaxies at their
  catalog distances. A layer exists only when the photographer allowed this use. The
  layers come from the approved derivative, never from the private master.
  """
  import Ecto.Query

  alias StarsmapApi.Catalog.CatalogSourceObject
  alias StarsmapApi.Community.{FieldCatalog, Photo, PhotoDepthLayer, Photos, Storage, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  @max_field_degrees 5.0
  @min_sources 3
  @files ["depth-base", "depth-sprites"]

  def files, do: @files
  def file_keys(id), do: Enum.map(@files, &"masters/#{id}/#{&1}.webp")

  def eligible?(%Photo{} = photo) do
    w = photo.wcs

    photo.depth_allowed and photo.status == "published" and is_map(w) and
      w["status"] == "solved" and
      max(w["width"], w["height"]) * w["pixel_scale_arcsec"] / 3600 <= @max_field_degrees
  end

  def enqueue(%Photo{} = photo) do
    if eligible?(photo) do
      Oban.insert(
        StarsmapApi.CommunityJobs,
        StarsmapApi.Community.DepthWorker.new(%{id: photo.id})
      )
    else
      :ok
    end
  end

  @doc "The photographer allows or withdraws the flight. A withdrawal deletes the layers at once."
  def set_allowed(user, id, allowed) when is_boolean(allowed) do
    case Photos.owned(user, id) do
      nil ->
        {:error, :not_found}

      photo ->
        changed = Repo.update!(Ecto.Changeset.change(photo, depth_allowed: allowed))
        if allowed, do: enqueue(changed), else: remove(changed.id)
        {:ok, Map.take(changed, [:id, :depth_allowed])}
    end
  end

  def set_allowed(_, _, _), do: {:error, :invalid_request}

  def remove(id) do
    Repo.delete_all(from l in PhotoDepthLayer, where: l.photo_id == ^id)

    # A missing file needs no action. PurgeWorker deletes what a failed call leaves.
    Enum.each(file_keys(id), &Storage.adapter().delete/1)
  end

  def ready?(%Photo{} = photo),
    do:
      photo.depth_allowed and
        Repo.exists?(from l in PhotoDepthLayer, where: l.photo_id == ^photo.id)

  @doc "Records with a measured or cataloged distance in the field of a solved photo."
  def records(%Photo{wcs: w}) do
    radius = :math.sqrt(w["width"] ** 2 + w["height"] ** 2) / 2 * w["pixel_scale_arcsec"] / 3600

    FieldCatalog.cone(w["ra_deg"], w["dec_deg"], radius,
      groups: FieldCatalog.gaia_groups() ++ FieldCatalog.named_groups(),
      limit: 1500
    )
    |> Enum.filter(&(is_number(&1.distance_ly) and &1.distance_ly > 0))
    |> Enum.map(fn record ->
      %{
        key: record.key,
        name: record.name,
        ra: record.ra,
        dec: record.dec,
        distance_ly: record.distance_ly,
        distance_method:
          if(record.group in FieldCatalog.gaia_groups(), do: "parallax", else: "catalog")
      }
    end)
  end

  @doc "The distance of the plane of unmatched light: the main subject, else the median non-star source."
  def plane_distance(%Photo{declared_key: key}, sources) do
    subject =
      StarsmapApi.Repo.one(
        from o in CatalogSourceObject, where: o.key == ^key, limit: 1, select: o.distance_ly
      )

    distances = Enum.map(sources, & &1["distance_ly"]) |> Enum.sort()

    cond do
      is_number(subject) and subject > 0 -> subject
      distances == [] -> nil
      true -> Enum.at(distances, div(length(distances), 2))
    end
  end

  def store(%Photo{} = photo, result) do
    sources = result["sources"] || []
    distinct = sources |> Enum.map(& &1["distance_ly"]) |> Enum.uniq() |> length()
    plane = plane_distance(photo, sources)

    if length(sources) >= @min_sources and distinct >= 2 and plane do
      Repo.insert!(
        %PhotoDepthLayer{
          photo_id: photo.id,
          plane_distance_ly: plane * 1.0,
          width: result["width"],
          height: result["height"],
          cell: result["cell"],
          detected: result["detected"],
          sources: %{"sources" => sources}
        },
        on_conflict: :replace_all,
        conflict_target: :photo_id
      )

      :ok
    else
      remove(photo.id)
      :not_enough
    end
  end

  @doc "The public payload. A photo that is not public, or not allowed, has no layers."
  def public(id) do
    with %Photo{} = photo <- Photos.get(id),
         true <- Photos.visible?(photo) && photo.depth_allowed,
         %PhotoDepthLayer{} = layers <- Repo.get(PhotoDepthLayer, id) do
      author = Repo.get!(User, photo.user_id)

      {:ok,
       %{
         photo_id: id,
         width: layers.width,
         height: layers.height,
         cell: layers.cell,
         detected: layers.detected,
         plane_distance_ly: layers.plane_distance_ly,
         sources: layers.sources["sources"],
         base_url: Storage.media_url(id, "depth-base"),
         sprites_url: Storage.media_url(id, "depth-sprites"),
         credit: %{
           name: author.name,
           handle: author.handle,
           licence: photo.licence,
           title: photo.title
         }
       }}
    else
      _ -> {:error, :not_found}
    end
  end
end

defmodule StarsmapApi.Community.DepthWorker do
  @moduledoc "Builds the depth layers of one photo in the serial media queue."
  use Oban.Worker, queue: :media, max_attempts: 2, unique: [keys: [:id], period: 3600]
  alias StarsmapApi.Community.{Depth, Photos, Storage}

  @limit_seconds 90

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}) do
    photo = Photos.get(id)

    if photo && Depth.eligible?(photo) do
      scratch = Path.join(Storage.root(), "depth-#{id}-#{System.unique_integer([:positive])}")
      File.mkdir_p!(scratch)

      try do
        run(photo, scratch)
      after
        File.rm_rf(scratch)
      end
    else
      :ok
    end
  end

  defp run(photo, scratch) do
    image = Path.join(scratch, "1600.webp")
    request = Path.join(scratch, "request.json")
    output = Path.join(scratch, "output")
    File.write!(request, Jason.encode!(%{records: Depth.records(photo), wcs: photo.wcs}))

    with {:storage, :ok} <-
           {:storage, Storage.adapter().get("masters/#{photo.id}/1600.webp", image)},
         {json, 0} <-
           System.cmd("timeout", [
             to_string(@limit_seconds),
             StarsmapApi.Community.python(),
             StarsmapApi.Community.backend_script("community_depth.py"),
             image,
             request,
             output
           ]),
         {:ok, result} <- Jason.decode(json),
         {:storage, :ok} <- {:storage, persist(photo, output, result)} do
      Depth.store(Photos.get(photo.id), result)
      :ok
    else
      # A storage fault or a script that did not end in time can pass at the next attempt.
      {:storage, {:error, reason}} -> {:error, reason}
      {:storage, other} -> {:error, other}
      # `timeout` exits with 124 after its SIGTERM, and with 137 after a SIGKILL.
      {_output, status} when status in [124, 137] -> {:error, :depth_timeout}
      # The output of the script is not valid: the same photo gives the same result again.
      _ -> {:cancel, "The depth layers cannot be built"}
    end
  end

  defp persist(photo, output, %{"sources" => [_ | _]}) do
    Enum.reduce_while(Depth.files(), :ok, fn name, :ok ->
      case Storage.adapter().put(
             "masters/#{photo.id}/#{name}.webp",
             Path.join(output, "#{name}.webp"),
             false
           ) do
        :ok -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end

  defp persist(_, _, _), do: :ok
end
