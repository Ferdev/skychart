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

  # The default is the production image layout; source checkouts configure their own root.
  def backend_script(name) do
    Path.join(Application.get_env(:starsmap_api, :community_backend_root, "/app/backend"), name)
  end

  def uuid(value) do
    case Ecto.UUID.cast(value) do
      {:ok, id} -> id
      _ -> nil
    end
  end
end
