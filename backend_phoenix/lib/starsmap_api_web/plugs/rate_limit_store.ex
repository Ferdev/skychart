defmodule StarsmapApiWeb.Plugs.RateLimitStore do
  @moduledoc false
  use GenServer

  @table StarsmapApiWeb.Plugs.RateLimit

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  def ensure_started do
    case GenServer.start(__MODULE__, :ok, name: __MODULE__) do
      {:ok, _pid} -> :ok
      {:error, {:already_started, _pid}} -> :ok
    end
  end

  @impl true
  def init(:ok) do
    if :ets.whereis(@table) == :undefined,
      do: :ets.new(@table, [:named_table, :set, :public, write_concurrency: true])

    {:ok, %{}}
  end
end
