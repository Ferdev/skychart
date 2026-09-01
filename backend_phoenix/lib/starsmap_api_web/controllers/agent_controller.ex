defmodule StarsmapApiWeb.AgentController do
  use StarsmapApiWeb, :controller

  alias StarsmapApiWeb.DiscoveryContent

  def show(conn, _params), do: html(conn, DiscoveryContent.agents_document())

  def guide_json(conn, _params) do
    conn
    |> put_resp_header("cache-control", "public, max-age=3600")
    |> json(DiscoveryContent.guide_json())
  end

  def llms(conn, _params) do
    conn
    |> put_resp_content_type("text/plain")
    |> put_resp_header("cache-control", "public, max-age=3600")
    |> send_resp(200, DiscoveryContent.llms_text())
  end

  def openapi(conn, _params) do
    path = Application.app_dir(:starsmap_api, "priv/openapi.json")

    conn
    |> put_resp_content_type("application/vnd.oai.openapi+json")
    |> put_resp_header("cache-control", "public, max-age=3600")
    |> send_file(200, path)
  end
end
