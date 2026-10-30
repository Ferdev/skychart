defmodule StarsmapApi.Community.MediaWorker do
  @moduledoc "Durable processing; approved derivatives never contain uploaded metadata."
  use Oban.Worker, queue: :media, max_attempts: 3, unique: [keys: [:id], period: 3600]
  alias StarsmapApi.Community.{Photos, Storage}
  alias StarsmapApi.CommunityRepo, as: Repo

  # A hung decode must not keep the single slot of the media queue. A 42 MP photo took
  # 47 seconds on half a CPU, and each decoder step stops at 40 seconds by itself.
  @decode_limit_seconds 120
  @decode_kill_after_seconds 5

  # A backstop: it stops only the job process. It has room for the decoder limit and
  # for 5 storage calls of 30 seconds each. The decoder limit comes first, so that
  # process/1 can remove the scratch files.
  @impl Oban.Worker
  def timeout(_job), do: :timer.minutes(5)

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}} = job) do
    photo = Photos.get(id)

    if photo && photo.status == "processing" do
      case process(photo) do
        # No retry follows the last attempt, so the photo must not stay in "processing".
        {:error, :decode_timeout} = error when job.attempt >= job.max_attempts ->
          mark_failed(photo)
          error

        result ->
          result
      end
    else
      :ok
    end
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
        # Each photo waits for a moderator. Publication is a moderator decision only
        # (StarsmapApi.Community.Moderation.review/4).
        case StarsmapApi.Community.transaction(fn ->
               photo = Photos.get(photo.id)

               if photo.status == "processing" do
                 Repo.update!(
                   Ecto.Changeset.change(photo,
                     status: "review",
                     sha256: data["sha256"],
                     assets: Map.merge(photo.assets, data)
                   )
                 )

                 {:ok, _} =
                   Oban.insert(
                     StarsmapApi.CommunityJobs,
                     StarsmapApi.Community.RetentionWorker.new(%{id: photo.id},
                       schedule_in: 604_800
                     )
                   )

                 StarsmapApi.Community.AdminNotifier.enqueue("photo_review", photo.id)
               end
             end) do
          {:ok, _} -> :ok
          error -> error
        end
      else
        {:error, :invalid_image} ->
          mark_failed(photo)
          {:cancel, "Image rejected by the decoder"}

        error ->
          error
      end
    after
      File.rm_rf(scratch)
    end
  end

  defp mark_failed(photo) do
    Repo.update!(Ecto.Changeset.change(Photos.get(photo.id), status: "failed"))
  end

  # A closed port does not stop an OS process, so the limit is on the decoder itself.
  # `timeout` signals its whole process group, which includes the vips processes.
  defp decode(source, scratch) do
    limit =
      Application.get_env(:starsmap_api, :community_decode_limit_seconds, @decode_limit_seconds)

    case System.cmd("timeout", [
           "--kill-after=#{@decode_kill_after_seconds}",
           to_string(limit),
           "python3",
           StarsmapApi.Community.backend_script("community_media.py"),
           source,
           Path.join(scratch, "output")
         ]) do
      {json, 0} -> Jason.decode(json)
      # 124: SIGTERM stopped the decoder. 137: SIGKILL stopped it.
      {_, status} when status in [124, 137] -> {:error, :decode_timeout}
      # `timeout` could not start the decoder. The image is not at fault.
      {_, status} when status in 125..127 -> {:error, :decoder_unavailable}
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
