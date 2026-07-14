defmodule StarsmapApi.Catalog.PublicCache do
  use GenServer
  @table __MODULE__
  @max_entries 10_000
  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  def get(key), do: lookup(key, System.monotonic_time(:millisecond))

  def put(key, value, ttl_ms) do
    now = System.monotonic_time(:millisecond)
    if :ets.info(@table, :size) >= @max_entries, do: prune(now)
    :ets.insert(@table, {key, value, now + ttl_ms})
    value
  end

  def clear, do: :ets.delete_all_objects(@table)

  def init(:ok),
    do: {:ok, :ets.new(@table, [:named_table, :set, :public, read_concurrency: true])}

  defp lookup(key, now) do
    case :ets.lookup(@table, key) do
      [{^key, value, expires}] when expires > now ->
        {:ok, value}

      [{^key, _, _}] ->
        :ets.delete(@table, key)
        :error

      [] ->
        :error
    end
  end

  defp prune(now) do
    :ets.select_delete(@table, [{{:_, :_, :"$1"}, [{:"=<", :"$1", now}], [true]}])

    if :ets.info(@table, :size) >= @max_entries do
      case :ets.first(@table) do
        :"$end_of_table" -> :ok
        key -> :ets.delete(@table, key)
      end
    end
  end
end
