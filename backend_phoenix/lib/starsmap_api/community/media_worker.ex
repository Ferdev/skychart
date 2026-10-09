defmodule StarsmapApi.Community.MediaWorker do
  @moduledoc "Durable processing; approved derivatives never contain uploaded metadata."
  use Oban.Worker, queue: :media, max_attempts: 3, unique: [keys: [:id], period: 3600]
  import Ecto.Query
  alias StarsmapApi.Community.{Photo, Photos, Storage, Ranking}
  alias StarsmapApi.CommunityRepo, as: Repo
  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}) do
    photo = Photos.get(id)
    if photo && photo.status == "processing", do: process(photo), else: :ok
  end

  def process(photo) do
    scratch =
      Path.join(Storage.root(), "scratch/#{photo.id}-#{System.unique_integer([:positive])}")

    File.mkdir_p!(scratch)

    try do
      source = Path.join(scratch, "upload")

      with :ok <- Storage.adapter().download(photo, source),
           {:ok, data} <- decode(source, scratch),
           :ok <- persist(photo, scratch) do
        case StarsmapApi.Community.transaction(fn ->
               photo = Photos.get(photo.id)

               approved =
                 Repo.aggregate(
                   from(p in Photo,
                     where: p.user_id == ^photo.user_id and not is_nil(p.published_at)
                   ),
                   :count
                 )

               status = if approved >= 3, do: "published", else: "review"

               if photo.status == "processing" do
                 photo =
                   Repo.update!(
                     Ecto.Changeset.change(photo,
                       status: status,
                       sha256: data["sha256"],
                       assets: Map.merge(photo.assets, data),
                       published_at:
                         if(status == "published", do: StarsmapApi.Community.now(), else: nil)
                     )
                   )

                 if status == "published" do
                   {:ok, _} =
                     Oban.insert(
                       StarsmapApi.CommunityJobs,
                       StarsmapApi.Community.PublishWorker.new(%{id: photo.id})
                     )

                   Ranking.refresh(photo.subject_id)
                 end

                 {:ok, _} =
                   Oban.insert(
                     StarsmapApi.CommunityJobs,
                     StarsmapApi.Community.RetentionWorker.new(%{id: photo.id},
                       schedule_in: 604_800
                     )
                   )
               end
             end) do
          {:ok, _} -> :ok
          error -> error
        end
      else
        {:error, :invalid_image} ->
          Repo.update!(Ecto.Changeset.change(Photos.get(photo.id), status: "failed"))
          {:cancel, "Image rejected by the decoder"}

        error ->
          error
      end
    after
      File.rm_rf(scratch)
    end
  end

  defp decode(source, scratch) do
    case System.cmd("python3", [
           StarsmapApi.Community.backend_script("community_media.py"),
           source,
           Path.join(scratch, "output")
         ]) do
      {json, 0} -> Jason.decode(json)
      _ -> {:error, :invalid_image}
    end
  end

  defp persist(photo, scratch) do
    for file <- ["master.png", "96.webp", "320.webp", "1600.webp"], reduce: :ok do
      :ok ->
        Storage.adapter().put(
          "masters/#{photo.id}/#{file}",
          Path.join(scratch, "output/#{file}"),
          false
        )

      error ->
        error
    end
  end
end

defmodule StarsmapApi.Community.PublishWorker do
  use Oban.Worker, queue: :publish, max_attempts: 5

  def perform(%Oban.Job{args: %{"id" => id}}) do
    StarsmapApi.Community.transaction(fn ->
      case StarsmapApi.Community.Photos.get(id) do
        nil -> :ok
        photo -> StarsmapApi.Community.Moderation.publish_files(photo)
      end
    end)
    |> case do
      {:ok, result} -> result
      error -> error
    end
  end
end

defmodule StarsmapApi.Community.RetentionWorker do
  use Oban.Worker, queue: :media, max_attempts: 5

  def perform(%Oban.Job{args: %{"id" => id}}) do
    photo = StarsmapApi.Community.Photos.get(id)

    if photo && photo.sha256 && photo.status not in ["uploading", "processing", "failed"] do
      case StarsmapApi.Community.Storage.adapter().delete(photo.source_key) do
        {:error, :enoent} -> :ok
        result -> result
      end
    else
      :ok
    end
  end
end
