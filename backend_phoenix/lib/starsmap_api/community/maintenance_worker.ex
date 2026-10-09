defmodule StarsmapApi.Community.MaintenanceWorker do
  @moduledoc "Daily cleanup of expired tokens and abandoned upload bytes."
  use Oban.Worker, queue: :media, max_attempts: 5
  import Ecto.Query
  alias StarsmapApi.Community.{Photo, Token, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  def perform(_) do
    cutoff = DateTime.add(StarsmapApi.Community.now(), -604_800)
    Repo.delete_all(from t in Token, where: t.expires_at < ^cutoff)

    photos =
      Repo.all(
        from p in Photo,
          where: p.status in ["uploading", "failed", "rejected"] and p.inserted_at < ^cutoff,
          limit: 200
      )

    Enum.reduce_while(photos, :ok, fn photo, _ ->
      case Storage.adapter().delete(photo.source_key) do
        result when result in [:ok, {:error, :enoent}] -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end
end

defmodule StarsmapApi.Community.PurgeWorker do
  @moduledoc "Remove all media bytes after account deletion; retain the audit record."
  # Serialize erasure with decoding so an in-flight upload cannot recreate bytes.
  use Oban.Worker, queue: :media, max_attempts: 5
  alias StarsmapApi.Community.{Photos, Storage, Moderation}

  def perform(%Oban.Job{args: %{"id" => id}}) do
    photo = Photos.get(id)

    if photo && not Photos.visible?(photo) do
      with :ok <- Moderation.publish_files(photo) do
        Enum.reduce_while(
          [
            photo.source_key
            | Enum.map(["master.png", "96.webp", "320.webp", "1600.webp"], &"masters/#{id}/#{&1}")
          ],
          :ok,
          fn key, _ ->
            case Storage.adapter().delete(key) do
              result when result in [:ok, {:error, :enoent}] -> {:cont, :ok}
              error -> {:halt, error}
            end
          end
        )
      end
    else
      :ok
    end
  end
end
