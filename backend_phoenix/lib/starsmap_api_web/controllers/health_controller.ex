defmodule StarsmapApiWeb.HealthController do
  use StarsmapApiWeb, :controller

  def show(conn, _params) do
    json(conn, %{ok: true, service: "starsmap_api"})
  end
end
