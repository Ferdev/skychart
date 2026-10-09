defmodule StarsmapApi.Community.RankingWorker do
  @moduledoc "Version-one snapshots every ten minutes; reads still check current visibility."
  use Oban.Worker, queue: :publish, max_attempts: 3
  alias StarsmapApi.CommunityRepo, as: Repo
  alias StarsmapApi.Community.Ranking

  def perform(_) do
    StarsmapApi.Community.transaction(fn ->
      for period <- ["all", "trend", "photographers"] do
        payload =
          if period == "photographers",
            do: %{photographers: Ranking.photographers()},
            else: %{ids: Enum.map(Ranking.ranked(period), & &1.id)}

        Repo.insert_all(
          "ranking_snapshots",
          [
            %{
              period: period,
              version: 1,
              generated_at: StarsmapApi.Community.now(),
              payload: payload
            }
          ],
          on_conflict: {:replace, [:version, :generated_at, :payload]},
          conflict_target: [:period]
        )
      end
    end)
    |> case do
      {:ok, _} -> :ok
      error -> error
    end
  end
end
