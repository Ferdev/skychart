defmodule StarsmapApi.Community.Transits do
  @moduledoc """
  Community transit timings.

  The browser sends measurements only. The server calculates each result from those
  measurements, and a moderator must approve it. A timing is a community result next to
  the archive values: it does not change an orbit and it does not confirm a planet.
  """
  import Ecto.Query

  alias StarsmapApi.Community.{
    Action,
    SolverWorker,
    Storage,
    TransitFit,
    TransitFrameSolve,
    TransitMeasurement,
    TransitObservation,
    User
  }

  alias StarsmapApi.CommunityRepo, as: Repo

  @daily_quota 10
  @daily_solves 10
  @max_frame_bytes 4_000_000
  @states ["review", "approved", "rejected", "hidden"]
  @public_timings 200

  @doc "A fit for the light curve window. Nothing is stored."
  def preview(params) do
    with {:ok, key, points} <- input(params), do: TransitFit.fit(key, points)
  end

  def submit(user, params) do
    with {:ok, key, points} <- input(params),
         {:ok, instrument} <- instrument(params["instrument"]),
         {:ok, night} <- night(params["night"]),
         {:ok, frames} <- frames(params["frame_count"], points),
         {:ok, target} <- target(params),
         # A person over the quota does not start a fit. The check in `insert` stops a race.
         :ok <- quota(user),
         {:ok, %{"accepted" => true} = fit} <- TransitFit.fit(key, points) do
      insert(user, key, target, night, frames, instrument, points, fit, params)
    else
      {:ok, %{"accepted" => false}} -> {:error, :transit_rejected}
      {:error, _} = error -> error
      _ -> {:error, :invalid_transit}
    end
  end

  defp quota(user) do
    since = DateTime.add(StarsmapApi.Community.now(), -86_400)

    count =
      Repo.aggregate(
        from(o in TransitObservation, where: o.user_id == ^user.id and o.inserted_at > ^since),
        :count
      )

    if count >= @daily_quota, do: {:error, :transit_quota}, else: :ok
  end

  defp insert(user, key, target, night, frames, instrument, points, fit, params) do
    StarsmapApi.Community.transaction(fn ->
      with {:error, reason} <- quota(user), do: Repo.rollback(reason)

      {:ok, moment, _} = DateTime.from_iso8601(fit["mid_time_utc"])
      id = Ecto.UUID.generate()

      changeset =
        %TransitObservation{
          id: id,
          user_id: user.id,
          object_key: key,
          host_key: target.host_key,
          object_name: target.name,
          target_status: target.status,
          epoch: fit["epoch"],
          night: night,
          mid_time_bjd: fit["mid_time_bjd_tdb"],
          mid_time_utc: %{moment | microsecond: {elem(moment.microsecond, 0), 6}},
          uncertainty_minutes: fit["uncertainty_minutes"] * 1.0,
          o_minus_c_minutes: fit["o_minus_c_minutes"] * 1.0,
          predicted_uncertainty_minutes: fit["predicted_uncertainty_minutes"] * 1.0,
          depth_ppt: fit["depth_ppt"] * 1.0,
          duration_minutes: fit["duration_minutes"] * 1.0,
          frame_count: frames,
          instrument: instrument,
          method_version: fit["method_version"],
          checks: checks(fit, params)
        }
        |> Ecto.Changeset.change()
        |> Ecto.Changeset.unique_constraint([:user_id, :object_key, :epoch])

      case Repo.insert(changeset) do
        {:ok, observation} ->
          Repo.insert!(%TransitMeasurement{
            observation_id: id,
            points: %{"points" => points, "model" => fit["model"]}
          })

          observation

        {:error, _} ->
          Repo.rollback(:transit_duplicate)
      end
    end)
  end

  defp checks(fit, params) do
    comparison = if is_map(params["comparison"]), do: params["comparison"], else: %{}

    fit
    |> Map.take([
      "reduced_chi_square",
      "red_noise_factor",
      "baseline_rms_ppt",
      "points_before",
      "points_in_transit",
      "points_after",
      "depth_error_ppt",
      "ephemeris"
    ])
    |> Map.put("comparison_count", number(comparison["count"]))
    |> Map.put("comparison_rms_ppt", number(comparison["check_rms_ppt"]))
    |> Map.put("frames_dropped", number(params["frames_dropped"]))
    |> Map.put("pipeline_version", text(params["pipeline_version"], 40))
  end

  defp number(value) when is_number(value), do: value
  defp number(_), do: nil
  defp text(value, limit) when is_binary(value), do: String.slice(value, 0, limit)
  defp text(_, _), do: nil

  defp input(%{"key" => key, "points" => points})
       when is_binary(key) and is_list(points) and length(points) in 20..4000 do
    if byte_size(key) <= 120 and Enum.all?(points, &point?/1),
      do: {:ok, key, points},
      else: {:error, :invalid_transit}
  end

  defp input(_), do: {:error, :invalid_transit}

  defp point?([a, b, c]) when is_number(a) and is_number(b) and is_number(c), do: true
  defp point?(_), do: false

  defp instrument(value) when is_binary(value) do
    text = String.trim(value)
    if byte_size(text) in 2..200, do: {:ok, text}, else: {:error, :invalid_transit}
  end

  defp instrument(_), do: {:error, :invalid_transit}

  defp night(value) when is_binary(value) do
    case Date.from_iso8601(value) do
      {:ok, date} -> {:ok, date}
      _ -> {:error, :invalid_transit}
    end
  end

  defp night(_), do: {:error, :invalid_transit}

  defp frames(value, points) when is_integer(value) and value >= length(points),
    do: {:ok, value}

  defp frames(_, _), do: {:error, :invalid_transit}

  defp target(%{"host_key" => host, "name" => name, "status" => status})
       when is_binary(host) and is_binary(name) and status in ["confirmed", "candidate"] do
    if byte_size(host) <= 120 and byte_size(name) <= 200,
      do: {:ok, %{host_key: host, name: name, status: status}},
      else: {:error, :invalid_transit}
  end

  defp target(_), do: {:error, :invalid_transit}

  @doc "Approved timings of a planet or of its host, with the summary of each planet."
  def public_list(key) do
    approved =
      from o in TransitObservation,
        join: u in User,
        on: u.id == o.user_id,
        where:
          o.review_state == "approved" and not u.suspended and
            (o.object_key == ^key or o.host_key == ^key)

    # The list shows the newest timings only. The fit of each planet uses all of its approved
    # timings, with only the fields that the fit reads.
    rows =
      Repo.all(
        from [o, u] in approved,
          order_by: [desc: o.mid_time_utc],
          limit: @public_timings,
          select: {o, u}
      )

    fit =
      Repo.all(
        from [o, _u] in approved,
          select:
            struct(o, [
              :id,
              :object_key,
              :user_id,
              :epoch,
              :uncertainty_minutes,
              :o_minus_c_minutes,
              :predicted_uncertainty_minutes,
              :checks
            ])
      )

    %{
      timings: Enum.map(rows, fn {o, u} -> public(o, u) end),
      planets:
        fit
        |> Enum.group_by(& &1.object_key)
        |> Enum.map(fn {planet, group} -> Map.put(summary(group), :key, planet) end)
    }
  end

  defp public(o, u) do
    Map.take(o, [
      :id,
      :object_key,
      :object_name,
      :target_status,
      :epoch,
      :night,
      :mid_time_bjd,
      :mid_time_utc,
      :uncertainty_minutes,
      :o_minus_c_minutes,
      :predicted_uncertainty_minutes,
      :depth_ppt,
      :duration_minutes,
      :frame_count,
      :instrument,
      :method_version
    ])
    |> Map.put(:observer, Map.take(u, [:handle, :name]))
  end

  @doc """
  The timing uncertainty that follows from the archive ephemeris and the approved timings.

  It is a weighted fit of a change of reference time and period, with the archive errors
  as the prior. The result is for the newest observed epoch, so that a reader can compare it
  with the archive prediction for the same orbit.
  """
  def summary(observations) do
    newest = Enum.max_by(observations, & &1.epoch)
    ephemeris = newest.checks["ephemeris"] || %{}
    day = 1440.0
    time_error = max((ephemeris["reference_time_err_days"] || 0) * 1.0, 1.0e-6)
    period_error = max((ephemeris["period_err_days"] || 0) * 1.0, 1.0e-9)

    {a, b, c, x, y, weight, total} =
      Enum.reduce(
        observations,
        {1 / time_error ** 2, 0.0, 1 / period_error ** 2, 0.0, 0.0, 0.0, 0.0},
        fn o, {a, b, c, x, y, weight, total} ->
          w = (day / o.uncertainty_minutes) ** 2
          r = o.o_minus_c_minutes / day

          {a + w, b + w * o.epoch, c + w * o.epoch * o.epoch, x + w * r, y + w * o.epoch * r,
           weight + w, total + w * r}
        end
      )

    determinant = a * c - b * b
    epoch = newest.epoch
    variance = (c - 2 * epoch * b + epoch * epoch * a) / determinant
    shift = (c * x - b * y + epoch * (a * y - b * x)) / determinant

    %{
      count: length(observations),
      observers: observations |> Enum.map(& &1.user_id) |> Enum.uniq() |> length(),
      epoch: epoch,
      mean_o_minus_c_minutes: Float.round(total / weight * day, 2),
      archive_uncertainty_minutes: newest.predicted_uncertainty_minutes,
      community_uncertainty_minutes: Float.round(:math.sqrt(max(variance, 0.0)) * day, 2),
      community_shift_minutes: Float.round(shift * day, 2)
    }
  end

  def mine(user),
    do:
      Repo.all(
        from o in TransitObservation,
          where: o.user_id == ^user.id,
          order_by: [desc: o.inserted_at],
          limit: 100
      )
      |> Enum.map(fn o ->
        o
        |> Map.take([
          :id,
          :object_key,
          :object_name,
          :night,
          :mid_time_utc,
          :uncertainty_minutes,
          :o_minus_c_minutes,
          :review_state,
          :moderation_reason
        ])
      end)

  def export(user), do: mine(user)

  def delete_all(user) do
    Repo.delete_all(from o in TransitObservation, where: o.user_id == ^user.id)
    Repo.delete_all(from s in TransitFrameSolve, where: s.user_id == ^user.id)
    :ok
  end

  def pending_count,
    do: Repo.aggregate(from(o in TransitObservation, where: o.review_state == "review"), :count)

  @doc "Observations of one state for the review tools, with the measurements and the checks."
  def review_list(state \\ "review") do
    state = if state in @states, do: state, else: "review"

    Repo.all(
      from o in TransitObservation,
        join: u in User,
        on: u.id == o.user_id,
        left_join: m in TransitMeasurement,
        on: m.observation_id == o.id,
        where: o.review_state == ^state,
        order_by: [asc: o.inserted_at],
        limit: 50,
        select: {o, u, m}
    )
    |> Enum.map(fn {o, u, m} ->
      public(o, u)
      |> Map.merge(%{
        review_state: o.review_state,
        moderation_reason: o.moderation_reason,
        submitted_at: o.inserted_at,
        checks: Map.delete(o.checks, "ephemeris"),
        measurements: m && m.points
      })
    end)
  end

  def review(user, id, action, reason) do
    state = %{"approve" => "approved", "reject" => "rejected", "hide" => "hidden"}[action]
    text = if action == "approve" and reason in [nil, ""], do: "Approved", else: reason

    cond do
      user.role not in ["admin", "moderator"] ->
        {:error, :not_allowed}

      is_nil(state) or not is_binary(text) or byte_size(text) not in 3..2000 ->
        {:error, :invalid_request}

      true ->
        StarsmapApi.Community.transaction(fn ->
          observation =
            (StarsmapApi.Community.uuid(id) && Repo.get(TransitObservation, id)) ||
              Repo.rollback(:not_found)

          updated =
            Repo.update!(
              Ecto.Changeset.change(observation,
                review_state: state,
                moderation_reason: if(state == "approved", do: nil, else: text),
                reviewed_at: StarsmapApi.Community.now()
              )
            )

          Repo.insert!(%Action{
            transit_id: updated.id,
            user_id: user.id,
            action: "transit_#{action}",
            reason: text
          })

          updated
        end)
    end
  end

  @doc """
  Queues one frame for the plate solver. This path is for frames with no sky coordinates
  in their header. The stored file is deleted after the solve.
  """
  def queue_frame(user, %{"image_base64" => encoded}) when is_binary(encoded) do
    since = DateTime.add(StarsmapApi.Community.now(), -86_400)

    with true <- SolverWorker.available?() || {:error, :solver_unavailable},
         {:ok, bytes} <- Base.decode64(encoded),
         true <- byte_size(bytes) <= @max_frame_bytes,
         <<0x89, "PNG", _::binary>> <- bytes,
         true <-
           Repo.aggregate(
             from(s in TransitFrameSolve, where: s.user_id == ^user.id and s.inserted_at > ^since),
             :count
           ) < @daily_solves || {:error, :transit_quota} do
      id = Ecto.UUID.generate()
      scratch = Path.join(Storage.root(), "frame-#{id}.png")
      File.mkdir_p!(Storage.root())
      File.write!(scratch, bytes)

      try do
        with :ok <- Storage.adapter().put(frame_key(id), scratch, false) do
          StarsmapApi.Community.transaction(fn ->
            solve = Repo.insert!(%TransitFrameSolve{id: id, user_id: user.id})

            {:ok, _} =
              Oban.insert(
                StarsmapApi.CommunityJobs,
                StarsmapApi.Community.FrameSolveWorker.new(%{id: id})
              )

            solve
          end)
        end
      after
        File.rm(scratch)
      end
    else
      {:error, reason} when reason in [:solver_unavailable, :transit_quota] -> {:error, reason}
      _ -> {:error, :invalid_transit}
    end
  end

  def queue_frame(_, _), do: {:error, :invalid_transit}

  def frame_key(id), do: "uploads/frames/#{id}.png"

  def frame_status(user, id) do
    case StarsmapApi.Community.uuid(id) && Repo.get(TransitFrameSolve, id) do
      %TransitFrameSolve{user_id: owner} = solve when owner == user.id ->
        {:ok, Map.take(solve, [:id, :status, :wcs])}

      _ ->
        {:error, :not_found}
    end
  end
end

defmodule StarsmapApi.Community.FrameSolveWorker do
  @moduledoc "Solves one frame with the bounded adapter of the photos, then deletes the file."
  use Oban.Worker, queue: :media, max_attempts: 2
  alias StarsmapApi.Community.{Astrometry, Storage, TransitFrameSolve, Transits}
  alias StarsmapApi.CommunityRepo, as: Repo

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}) do
    solve = Repo.get(TransitFrameSolve, id)

    if solve do
      scratch = Path.join(Storage.root(), "frame-solve-#{id}")
      File.mkdir_p!(scratch)

      try do
        image = Path.join(scratch, "frame.png")

        result =
          with :ok <- Storage.adapter().get(Transits.frame_key(id), image),
               {json, 0} <-
                 System.cmd("python3", [
                   StarsmapApi.Community.backend_script("community_solve.py"),
                   image,
                   scratch
                 ]),
               {:ok, attrs} <- Jason.decode(json),
               {:ok, wcs} <- Astrometry.validate(attrs) do
            {:ok, Map.merge(wcs, Map.take(attrs, ["cd", "crpix"]))}
          end

        Storage.adapter().delete(Transits.frame_key(id))

        changes =
          case result do
            {:ok, wcs} -> [status: "solved", wcs: wcs]
            _ -> [status: "failed"]
          end

        Repo.update!(Ecto.Changeset.change(solve, changes))
        :ok
      after
        File.rm_rf(scratch)
      end
    else
      :ok
    end
  end
end
