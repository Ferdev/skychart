defmodule StarsmapApi.Community.SolverWorker do
  @moduledoc "Optional bounded solves; failures preserve ordinary object-linked photos."
  use Oban.Worker, queue: :media, max_attempts: 2, unique: [keys: [:id], period: 3600]
  alias StarsmapApi.Community.{Photos, Storage, Astrometry, Ranking}
  alias StarsmapApi.CommunityRepo, as: Repo
  @no_solution "No supported plate solution was found"
  def available?, do: not is_nil(System.find_executable("solve-field"))

  # community_solve.py stops solve-field after 45 seconds, but not the processes that solve-field
  # starts, and nothing stops a Python process that hangs. A closed port does not stop an OS
  # process, so the limit is on the command itself: `timeout` signals its whole process group.
  @solve_limit_seconds 90
  @solve_kill_after_seconds 5

  # A backstop: it stops only the job process. The command limit comes first, so that perform/1
  # can remove the scratch directory.
  @impl Oban.Worker
  def timeout(_job), do: :timer.minutes(3)

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

        with {:storage, :ok} <-
               {:storage, Storage.adapter().get("masters/#{id}/1600.webp", image)},
             {:solve, {:ok, json}} <- {:solve, solve(image, scratch)},
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
              StarsmapApi.Community.Depth.enqueue(changed)
              StarsmapApi.Community.Findings.enqueue(changed)
              StarsmapApi.Community.DeepFields.photo_ready(changed)
            end
          end)

          :ok
        else
          # Oban runs the job again for an error, until `max_attempts`. A solve that did not end
          # in time is a worker fault, so it is an error too.
          {:storage, error} -> {:error, {:storage, error}}
          {:solve, failure} -> failure
          _ -> {:cancel, @no_solution}
        end
      after
        File.rm_rf(scratch)
      end
    else
      :ok
    end
  end

  defp solve(image, scratch) do
    limit =
      Application.get_env(:starsmap_api, :community_solve_limit_seconds, @solve_limit_seconds)

    case System.cmd("timeout", [
           "--kill-after=#{@solve_kill_after_seconds}",
           to_string(limit),
           "python3",
           StarsmapApi.Community.backend_script("community_solve.py"),
           image,
           scratch
         ]) do
      {json, 0} -> {:ok, json}
      # `timeout` exits with 124 after its SIGTERM stopped the solve.
      {_, 124} -> {:error, :solver_timeout}
      {output, status} -> solve_failure(output, status)
    end
  end

  # The script writes the error JSON when the solver ran and found no solution. Another exit (a
  # crash, a SIGKILL after the limit, or a stop at a resource limit) can be temporary.
  defp solve_failure(output, status) do
    case Jason.decode(output) do
      {:ok, %{"error" => _}} -> {:cancel, @no_solution}
      _ -> {:error, {:solver_exit, status}}
    end
  end
end
