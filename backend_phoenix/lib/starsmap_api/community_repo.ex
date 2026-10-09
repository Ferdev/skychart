defmodule StarsmapApi.CommunityRepo do
  @moduledoc "Writable community data, isolated from the scientific catalog."
  use Ecto.Repo, otp_app: :starsmap_api, adapter: Ecto.Adapters.Postgres
end
