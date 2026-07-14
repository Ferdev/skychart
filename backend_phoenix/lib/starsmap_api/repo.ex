defmodule StarsmapApi.Repo do
  use Ecto.Repo,
    otp_app: :starsmap_api,
    adapter: Ecto.Adapters.Postgres
end
