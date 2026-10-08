defmodule StarsmapApi.Community.SolverWorker do
  @moduledoc "Optional bounded solves; failures preserve ordinary object-linked photos."
  use Oban.Worker, queue: :media, max_attempts: 2, unique: [keys: [:id], period: 3600]
  alias StarsmapApi.Community.{Photos, Storage, Astrometry, Ranking}
  alias StarsmapApi.CommunityRepo, as: Repo
  def available?, do: not is_nil(System.find_executable("solve-field"))

  def enqueue(user, id) do
    case Photos.owned(user, id) do
      %{status: status} = photo when status in ["review", "published"] ->
        if available?(),
          do: Oban.insert(StarsmapApi.CommunityJobs, new(%{id: photo.id})),
          else: {:error, :solver_unavailable}

      _ ->
        {:error, :not_ready}
    end
  end

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}) do
    photo = Photos.get(id)

    if photo && photo.status in ["review", "published"] do
      scratch = Path.join(Storage.root(), "solve-#{id}-#{System.unique_integer([:positive])}")
      File.mkdir_p!(scratch)

      try do
        image = Path.join(scratch, "photo.webp")

        with :ok <- Storage.adapter().get("masters/#{id}/1600.webp", image),
             {json, 0} <-
               System.cmd("python3", ["/app/backend/community_solve.py", image, scratch]),
             {:ok, attrs} <- Jason.decode(json),
             {:ok, wcs} <- Astrometry.validate(attrs) do
          StarsmapApi.Community.transaction(fn ->
            current = Photos.get(id)

            if current.status in ["review", "published"] do
              changed =
                Repo.update!(
                  Ecto.Changeset.change(current,
                    wcs:
                      Map.merge(wcs, Map.take(attrs, ["cd", "crpix"]))
                      |> Map.merge(%{"source" => "Astrometry.net", "status" => "solved"})
                  )
                )

              StarsmapApi.Community.Annotations.rebuild(changed)

              if current.status == "published", do: Ranking.refresh(current.subject_id)
            end
          end)

          :ok
        else
          _ -> {:cancel, "No supported plate solution was found"}
        end
      after
        File.rm_rf(scratch)
      end
    else
      :ok
    end
  end
end
