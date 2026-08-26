defmodule StarsmapApi.SkyShare.CardCache do
  @moduledoc false
  use GenServer

  @table __MODULE__
  @max_entries 96

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  def get(key) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table, key) do
      [{^key, value, expires, _inserted}] when expires > now ->
        {:ok, value}

      [{^key, _value, _expires, _inserted}] ->
        :ets.delete(@table, key)
        :error

      [] ->
        :error
    end
  end

  def put(key, value, ttl_ms) do
    now = System.monotonic_time(:millisecond)
    prune(now)
    :ets.insert(@table, {key, value, now + ttl_ms, now})
    value
  end

  def clear, do: :ets.delete_all_objects(@table)

  @impl true
  def init(:ok),
    do: {:ok, :ets.new(@table, [:named_table, :set, :public, read_concurrency: true])}

  defp prune(now) do
    :ets.select_delete(@table, [{{:_, :_, :"$1", :_}, [{:"=<", :"$1", now}], [true]}])

    if :ets.info(@table, :size) >= @max_entries do
      @table
      |> :ets.tab2list()
      |> Enum.min_by(fn {_key, _value, _expires, inserted} -> inserted end, fn -> nil end)
      |> case do
        {key, _value, _expires, _inserted} -> :ets.delete(@table, key)
        nil -> :ok
      end
    end
  end
end
