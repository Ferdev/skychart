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
        limit: 50
    )
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

  def upsert_all(events),
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
