defmodule StarsmapApi.SkyEvents do
  import Ecto.Query
  alias StarsmapApi.{Repo, SkyEvents.SkyEvent}

  def list_upcoming(now \\ DateTime.utc_now()) do
    Repo.all(
      from e in SkyEvent,
        where:
          (e.kind == "new_exoplanet" and
             e.starts_at >= ^DateTime.add(now, -30 * 86_400, :second)) or
            (e.kind != "new_exoplanet" and
               e.starts_at >= ^DateTime.add(now, -86_400, :second)),
        order_by: e.starts_at,
        limit: 200
    )
    |> one_row_per_object_and_day()
    |> Enum.take(50)
  rescue
    error in Postgrex.Error ->
      if undefined_table?(error), do: [], else: reraise(error, __STACKTRACE__)
  end

  def last_refreshed_at do
    Repo.one(from e in SkyEvent, select: max(e.updated_at))
  rescue
    error in Postgrex.Error ->
      if undefined_table?(error), do: nil, else: reraise(error, __STACKTRACE__)
  end

  # A source can change the predicted time of an event. An older row for the same object and UTC day
  # is then a duplicate. The list keeps the row that was updated last.
  defp one_row_per_object_and_day(events) do
    events
    |> Enum.group_by(&{&1.source, &1.kind, &1.title, DateTime.to_date(&1.starts_at)})
    |> Enum.map(fn {_key, rows} -> Enum.max_by(rows, & &1.updated_at, DateTime) end)
    |> Enum.sort_by(& &1.starts_at, DateTime)
  end

  def upsert_all(events) do
    with {:ok, count} <- upsert_each(events) do
      Enum.each(events, &delete_superseded/1)
      {:ok, count}
    end
  end

  # Removes the old rows of a close approach when its predicted time changed and the source id changed with it.
  defp delete_superseded(%{
         source: source,
         source_id: source_id,
         kind: "close_approach",
         title: title,
         starts_at: %DateTime{} = starts_at
       }) do
    day_start = DateTime.new!(DateTime.to_date(starts_at), ~T[00:00:00], "Etc/UTC")
    day_end = DateTime.add(day_start, 86_400, :second)

    Repo.delete_all(
      from e in SkyEvent,
        where:
          e.source == ^source and e.kind == "close_approach" and e.title == ^title and
            e.source_id != ^source_id and e.starts_at >= ^day_start and e.starts_at < ^day_end
    )
  end

  defp delete_superseded(_attrs), do: :ok

  defp upsert_each(events),
    do:
      Enum.reduce_while(events, {:ok, 0}, fn attrs, {:ok, n} ->
        case Repo.insert(SkyEvent.changeset(%SkyEvent{}, attrs),
               on_conflict:
                 {:replace,
                  [
                    :kind,
                    :title,
                    :summary,
                    :starts_at,
                    :ends_at,
                    :catalog_key,
                    :source_url,
                    :facts,
                    :updated_at
                  ]},
               conflict_target: [:source, :source_id]
             ) do
          {:ok, _} -> {:cont, {:ok, n + 1}}
          error -> {:halt, error}
        end
      end)

  defp undefined_table?(%Postgrex.Error{postgres: %{code: code}}),
    do: code in [:undefined_table, "42P01"]

  defp undefined_table?(_), do: false
end
