defmodule StarsmapApi.Community do
  @moduledoc "Feature switches and serialized durable community changes."
  alias StarsmapApi.CommunityRepo, as: Repo
  def enabled?, do: Application.get_env(:starsmap_api, :community_enabled, false)

  def transaction(fun) do
    Repo.transaction(fn ->
      # Allocate index versions in commit order, including removals.
      Repo.query!("SELECT pg_advisory_xact_lock(4781411)")
      fun.()
    end)
  end

  def now, do: DateTime.utc_now()

  def uuid(value) do
    case Ecto.UUID.cast(value) do
      {:ok, id} -> id
      _ -> nil
    end
  end
end
