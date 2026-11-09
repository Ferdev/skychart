defmodule StarsmapApi.Community.Tours do
  @moduledoc """
  Guided tours of a signed-in person, shared from an unlisted address.

  A tour has one of three states. `shared` opens for each person with the address.
  `held` is the state after reports from three different clients: the tour does not open until
  a moderator decides. Each report goes to the queue, and one client counts once for each tour,
  so one visitor cannot take a tour offline. A tour that a moderator already kept stays open
  after reports and only waits in the queue. When its author changes the title, description or
  steps of a kept tour, it is `held` until a moderator decides on the new content.
  `hidden` is a decision of a moderator. The step format is the one of the published tours.
  """
  import Ecto.Query
  alias StarsmapApi.Community.{Action, Tour, TourReport, User}
  alias StarsmapApi.CommunityRepo, as: Repo

  @shared_prefix "shared-"
  # The number of different clients whose open reports hold a tour that no moderator kept.
  # It is also in the moduledoc.
  @hold_reporters 3
  @per_account 50
  @max_steps 30
  @max_title 120
  @max_description 500
  @max_caption 2000
  @max_view_state 2000
  @view_keys ~w(v c z t o cmp r L hc F sky sc sl sf u3 u3c u3t)

  def list(user) do
    Repo.all(from t in Tour, where: t.user_id == ^user.id, order_by: [desc: t.updated_at])
    |> Enum.map(&own/1)
  end

  def create(user, attrs) do
    with {:ok, fields} <- fields(attrs) do
      StarsmapApi.Community.transaction(fn ->
        count = Repo.aggregate(from(t in Tour, where: t.user_id == ^user.id), :count)
        if count >= @per_account, do: Repo.rollback(:tour_quota)

        token = :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)
        Repo.insert!(struct!(%Tour{user_id: user.id, token: token}, fields)) |> own()
      end)
    end
  end

  def update(user, id, attrs) do
    with {:ok, fields} <- fields(attrs) do
      StarsmapApi.Community.transaction(fn ->
        case owned(user, id) do
          nil ->
            Repo.rollback(:not_found)

          tour ->
            tour |> Ecto.Changeset.change(review_changes(tour, fields)) |> Repo.update!() |> own()
        end
      end)
    end
  end

  # A keep decision is for the content that the moderator read. New content of a kept tour
  # waits for a moderator again.
  defp review_changes(%Tour{status: "shared", reviewed_at: %DateTime{}} = tour, fields) do
    if Map.take(tour, Map.keys(fields)) == fields,
      do: fields,
      else: Map.merge(fields, %{status: "held", reviewed_at: nil})
  end

  defp review_changes(_tour, fields), do: fields

  def delete(user, id) do
    case owned(user, id) do
      %Tour{} = tour ->
        Repo.delete!(tour)
        {:ok, :deleted}

      nil ->
        {:error, :not_found}
    end
  end

  @doc "The player payload of a tour that opens for visitors. It has no account data but the name."
  def shared(token) do
    case open_tour(token) do
      {tour, author} ->
        %{
          slug: @shared_prefix <> tour.token,
          title: tour.title,
          description: tour.description,
          author: author,
          steps: tour.steps
        }

      nil ->
        nil
    end
  end

  @doc """
  A report of a visitor. `client` is the address of the client; only a keyed hash of it, different
  for each tour, is stored. A second open report of one client on one tour adds nothing.
  """
  def report(token, reason, client) when is_binary(client) do
    with true <- StarsmapApi.Community.valid_reason?(reason),
         {tour, _author} <- open_tour(token) do
      StarsmapApi.Community.transaction(fn ->
        reporter = reporter(tour, client)

        unless Repo.exists?(
                 from r in TourReport,
                   where:
                     r.tour_id == ^tour.id and r.reporter == ^reporter and is_nil(r.resolved_at)
               ),
               do: Repo.insert!(%TourReport{tour_id: tour.id, reason: reason, reporter: reporter})

        if is_nil(tour.reviewed_at) and open_reporters(tour) >= @hold_reporters, do: hold(tour)
        :ok
      end)
    else
      false -> {:error, :invalid_report}
      nil -> {:error, :not_found}
    end
  end

  @doc "The tours that wait for a moderator and the tours that a moderator hid."
  def review_list do
    open = from r in TourReport, where: r.tour_id == parent_as(:tour).id and is_nil(r.resolved_at)

    tours =
      Repo.all(
        from t in Tour,
          as: :tour,
          join: u in User,
          on: u.id == t.user_id,
          where: t.status in ["held", "hidden"] or exists(open),
          order_by: [desc: t.updated_at, asc: t.id],
          limit: 50,
          select: {t, u.handle, u.name}
      )

    ids = Enum.map(tours, fn {tour, _, _} -> tour.id end)

    reports =
      Repo.all(
        from r in TourReport,
          where: r.tour_id in ^ids and is_nil(r.resolved_at),
          order_by: [asc: r.inserted_at, asc: r.id],
          select: {r.tour_id, %{reason: r.reason, at: r.inserted_at}}
      )
      |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))

    Enum.map(tours, fn {tour, handle, name} ->
      Map.take(tour, [:id, :title, :description, :steps, :status, :moderation_reason, :updated_at])
      |> Map.merge(%{
        url: "/?tour=#{@shared_prefix}#{tour.token}",
        author: %{handle: handle, name: name},
        reports: Map.get(reports, tour.id, [])
      })
    end)
  end

  @doc "The tours that wait for a moderator: held, or with an open report."
  def waiting_count do
    reported =
      from(r in TourReport, where: r.tour_id == parent_as(:tour).id and is_nil(r.resolved_at))

    Repo.aggregate(
      from(t in Tour, as: :tour, where: t.status == "held" or exists(reported)),
      :count
    )
  end

  @doc "`keep` and `restore` open the tour again, and `hide` closes it. Each decision has an audit record."
  def review(actor, id, action, reason)
      when action in ["keep", "restore"] and reason in [nil, ""],
      do: review(actor, id, action, if(action == "keep", do: "Kept", else: "Restored"))

  def review(actor, id, action, reason)
      when action in ["keep", "hide", "restore"] and is_binary(reason) do
    tour = if StarsmapApi.Community.uuid(id), do: Repo.get(Tour, id)

    cond do
      actor.role not in ["moderator", "admin"] ->
        {:error, :not_allowed}

      # The limit is in characters, as for the reasons of photos: a reason in any script fits.
      not StarsmapApi.Community.valid_reason?(reason) or String.length(String.trim(reason)) < 3 ->
        {:error, :invalid_reason}

      is_nil(tour) ->
        {:error, :not_found}

      true ->
        StarsmapApi.Community.transaction(fn ->
          now = StarsmapApi.Community.now()

          changed =
            tour
            |> Ecto.Changeset.change(
              if(action == "hide",
                do: [status: "hidden", moderation_reason: reason],
                else: [status: "shared", moderation_reason: nil, reviewed_at: now]
              )
            )
            |> Repo.update!()

          Repo.update_all(
            from(r in TourReport, where: r.tour_id == ^tour.id and is_nil(r.resolved_at)),
            set: [resolved_at: now]
          )

          Repo.insert!(%Action{
            tour_id: tour.id,
            user_id: actor.id,
            action: "tour_#{action}",
            reason: reason
          })

          changed
        end)
    end
  end

  def review(_, _, _, _), do: {:error, :not_allowed}

  @doc "The tours of a person for the account export."
  def export(user) do
    Repo.all(from t in Tour, where: t.user_id == ^user.id)
    |> Enum.map(
      &Map.take(&1, [
        :id,
        :title,
        :description,
        :steps,
        :status,
        :token,
        :inserted_at,
        :updated_at
      ])
    )
  end

  def delete_all(user), do: Repo.delete_all(from t in Tour, where: t.user_id == ^user.id)

  defp reporter(tour, client),
    do:
      StarsmapApi.Community.Accounts.hash("tour-report:#{tour.id}:#{client}")
      |> Base.encode16(case: :lower)
      |> binary_part(0, 32)

  # A report from before the reporter column has no reporter, and counts as one.
  defp open_reporters(tour) do
    Repo.one(
      from r in TourReport,
        where: r.tour_id == ^tour.id and is_nil(r.resolved_at),
        select: fragment("count(DISTINCT coalesce(?, ?::text))", r.reporter, r.id)
    )
  end

  defp hold(%Tour{status: "shared"} = tour),
    do: tour |> Ecto.Changeset.change(status: "held") |> Repo.update!()

  defp hold(tour), do: tour

  defp owned(user, id) do
    if StarsmapApi.Community.uuid(id), do: Repo.get_by(Tour, id: id, user_id: user.id)
  end

  defp open_tour(token) when is_binary(token) do
    Repo.one(
      from t in Tour,
        join: u in User,
        on: u.id == t.user_id,
        where: t.token == ^token and t.status == "shared" and not u.suspended,
        select: {t, u.name}
    )
  end

  defp open_tour(_), do: nil

  defp own(tour) do
    Map.take(tour, [:id, :title, :description, :steps, :status, :moderation_reason, :updated_at])
    |> Map.put(:url, "/?tour=#{@shared_prefix}#{tour.token}")
  end

  defp fields(attrs) when is_map(attrs) do
    title = trimmed(attrs["title"])
    description = trimmed(attrs["description"] || "")
    steps = attrs["steps"]

    with true <- is_binary(title) and String.length(title) in 1..@max_title,
         true <- is_binary(description) and String.length(description) <= @max_description,
         true <- is_list(steps) and length(steps) in 1..@max_steps,
         normalized = Enum.map(steps, &step/1),
         true <- Enum.all?(normalized) do
      {:ok, %{title: title, description: description, steps: normalized}}
    else
      _ -> {:error, :invalid_tour}
    end
  end

  defp fields(_), do: {:error, :invalid_tour}

  defp step(%{"viewState" => view, "title" => title} = attrs) do
    title = trimmed(title)
    body = trimmed(attrs["body"] || "")

    if is_binary(title) and String.length(title) in 1..@max_title and is_binary(body) and
         String.length(body) <= @max_caption and view_state?(view),
       do: %{"viewState" => view, "title" => title, "body" => body}
  end

  defp step(_), do: nil

  defp trimmed(value) when is_binary(value), do: String.trim(value)
  defp trimmed(value), do: value

  # The same checks as `scripts/validate_tours.mjs`, with the parameters of a shared view only.
  defp view_state?(view) when is_binary(view) and byte_size(view) <= @max_view_state do
    query = URI.decode_query(view)

    query["v"] == "1" and Map.keys(query) -- @view_keys == [] and is_binary(query["L"]) and
      is_binary(query["t"]) and query["t"] != "" and center?(query["c"]) and positive?(query["z"])
  rescue
    ArgumentError -> false
  end

  defp view_state?(_), do: false

  defp center?(value) when is_binary(value) do
    case String.split(value, ",") do
      [x, y] -> number(x) != nil and number(y) != nil
      _ -> false
    end
  end

  defp center?(_), do: false

  defp positive?(value) when is_binary(value), do: (number(value) || 0) > 0
  defp positive?(_), do: false

  defp number(text) do
    case Float.parse(text) do
      {value, ""} -> value
      _ -> nil
    end
  end
end
