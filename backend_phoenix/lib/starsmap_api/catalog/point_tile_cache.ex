defmodule StarsmapApi.Catalog.PointTileCache do
  @moduledoc """
  Small in-memory cache for binary catalog point tiles.

  Point tiles are immutable between catalog imports, and the browser commonly
  asks for the same tile again while panning, zooming, or retrying failed loads.
  Keeping the encoded binary payload in ETS avoids repeating the same large
  spatial query and serialization work on hot tiles.
  """

  use GenServer

  @table __MODULE__
  @default_ttl_ms :timer.minutes(10)
  @default_max_entries 384

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def fetch(key) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table, key) do
      [{^key, expires_at, payload, _inserted_at}] when expires_at > now ->
        {:ok, payload}

      [{^key, _expires_at, _payload, _inserted_at}] ->
        :ets.delete(@table, key)
        :miss

      [] ->
        :miss
    end
  rescue
    ArgumentError -> :miss
  end

  def put(key, payload) do
    GenServer.call(__MODULE__, {:put, key, payload}, 5_000)
  catch
    :exit, _reason -> :ok
  end

  def clear do
    GenServer.call(__MODULE__, :clear, 5_000)
  catch
    :exit, _reason -> :ok
  end

  @impl true
  def init(opts) do
    :ets.new(@table, [
      :named_table,
      :public,
      {:read_concurrency, true},
      {:write_concurrency, true}
    ])

    state = %{
      ttl_ms: Keyword.get(opts, :ttl_ms, cache_ttl_ms()),
      max_entries: Keyword.get(opts, :max_entries, cache_max_entries())
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:put, key, payload}, _from, state) do
    now = System.monotonic_time(:millisecond)
    :ets.insert(@table, {key, now + state.ttl_ms, payload, now})
    prune(now, state.max_entries)

    {:reply, :ok, state}
  end

  def handle_call(:clear, _from, state) do
    :ets.delete_all_objects(@table)
    {:reply, :ok, state}
  end

  defp prune(now, max_entries) do
    expired_keys =
      :ets.select(@table, [
        {{:"$1", :"$2", :_, :_}, [{:<, :"$2", now}], [:"$1"]}
      ])

    Enum.each(expired_keys, &:ets.delete(@table, &1))

    entry_count = :ets.info(@table, :size) || 0

    if entry_count > max_entries do
      removable_count = entry_count - max_entries

      @table
      |> :ets.tab2list()
      |> Enum.sort_by(fn {_key, _expires_at, _payload, inserted_at} -> inserted_at end)
      |> Enum.take(removable_count)
      |> Enum.each(fn {key, _expires_at, _payload, _inserted_at} ->
        :ets.delete(@table, key)
      end)
    end
  end

  defp cache_ttl_ms do
    :starsmap_api
    |> Application.get_env(__MODULE__, [])
    |> Keyword.get(:ttl_ms, @default_ttl_ms)
  end

  defp cache_max_entries do
    :starsmap_api
    |> Application.get_env(__MODULE__, [])
    |> Keyword.get(:max_entries, @default_max_entries)
  end
end
