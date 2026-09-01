defmodule StarsmapApiWeb.PageController do
  use StarsmapApiWeb, :controller

  def index(conn, _params) do
    send_shell(conn, :atlas)
  end

  def embed(conn, _params) do
    send_shell(conn, :embed)
  end

  defp send_shell(conn, mode) do
    head =
      case catalog_tile_manifest_url() do
        "" ->
          ""

        _manifest_url ->
          ~s(<meta name="catalog-tile-manifest-url" content="/catalog-tiles/v1/manifest.json">)
      end

    case StarsmapApiWeb.ServerShell.render(mode: mode, head: head) do
      {:ok, document} ->
        conn |> put_resp_content_type("text/html") |> send_resp(200, document)

      {:error, :not_built} ->
        conn
        |> put_status(:service_unavailable)
        |> html("""
        <!doctype html>
        <html lang="en">
          <head><meta charset="utf-8"><title>Starsmap atlas not built</title></head>
          <body>
            <h1>Starsmap atlas is not built yet</h1>
            <p>Build the Vite atlas and copy it into backend_phoenix/priv/static before using Phoenix as the browser entrypoint.</p>
          </body>
        </html>
        """)
    end
  end

  def about(conn, _params) do
    html(conn, StarsmapApiWeb.DiscoveryContent.about_document())
  end

  def sentry_test(conn, _params) do
    Sentry.capture_message("Cosmic Atlas forced server test", level: :error)
    json(conn, %{ok: true})
  end

  defp catalog_tile_manifest_url do
    "CATALOG_TILE_MANIFEST_URL"
    |> System.get_env("")
    |> String.trim()
  end
end
