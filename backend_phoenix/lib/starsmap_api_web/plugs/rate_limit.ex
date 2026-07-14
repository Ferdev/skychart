defmodule StarsmapApiWeb.Plugs.RateLimit do
  @behaviour Plug
  import Plug.Conn
  alias StarsmapApiWeb.ClientIp
  @table __MODULE__
  @max_clients 20_000

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, opts) do
    ensure_table()
    capacity = capacity(Keyword.get(opts, :capacity, 240))
    refill = Keyword.get(opts, :refill_per_second, 4.0)
    now = System.monotonic_time(:millisecond)
    window_ms = window_ms(capacity, refill)
    key = {ClientIp.resolve(conn), div(now, window_ms)}
    count = :ets.update_counter(@table, key, {2, 1}, {key, 0, now})

    if count <= capacity do
      maybe_prune(now)
      conn
    else
      conn |> put_resp_header("retry-after", "1") |> send_resp(429, "Too many requests") |> halt()
    end
  end

  def reset, do: if(:ets.whereis(@table) != :undefined, do: :ets.delete_all_objects(@table))

  defp window_ms(capacity, refill) when is_number(refill) and refill > 0,
    do: max(round(capacity / refill * 1_000), 1_000)

  defp window_ms(_capacity, _refill), do: 60_000

  defp capacity(default) do
    case Integer.parse(System.get_env("RATE_LIMIT_CAPACITY_OVERRIDE", "")) do
      {value, ""} when value > 0 -> value
      _ -> default
    end
  end

  defp ensure_table do
    if :ets.whereis(@table) == :undefined,
      do: StarsmapApiWeb.Plugs.RateLimitStore.ensure_started()
  end

  defp maybe_prune(now) do
    if :ets.info(@table, :size) > @max_clients do
      cutoff = now - 300_000
      :ets.select_delete(@table, [{{:_, :_, :"$1"}, [{:<, :"$1", cutoff}], [true]}])

      if :ets.info(@table, :size) > @max_clients do
        case :ets.first(@table) do
          :"$end_of_table" -> :ok
          key -> :ets.delete(@table, key)
        end
      end
    end
  end
end
