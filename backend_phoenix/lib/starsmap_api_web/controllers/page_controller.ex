defmodule StarsmapApiWeb.PageController do
  use StarsmapApiWeb, :controller

  def index(conn, _params) do
    index_path = Application.app_dir(:starsmap_api, "priv/static/index.html")

    if File.regular?(index_path) do
      send_index(conn, index_path)
    else
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

  defp send_index(conn, index_path) do
    case catalog_tile_manifest_url() do
      "" ->
        conn
        |> put_resp_content_type("text/html")
        |> send_file(200, index_path)

      manifest_url ->
        index_path
        |> File.read!()
        |> inject_catalog_tile_manifest_url(manifest_url)
        |> then(fn html ->
          conn
          |> put_resp_content_type("text/html")
          |> send_resp(200, html)
        end)
    end
  end

  defp catalog_tile_manifest_url do
    "CATALOG_TILE_MANIFEST_URL"
    |> System.get_env("")
    |> String.trim()
  end

  defp inject_catalog_tile_manifest_url(html, manifest_url) do
    tag = ~s(<meta name="catalog-tile-manifest-url" content="#{html_escape(manifest_url)}">)

    if String.contains?(html, "</head>") do
      String.replace(html, "</head>", "    #{tag}\n</head>", global: false)
    else
      tag <> "\n" <> html
    end
  end

  defp html_escape(value) do
    value
    |> String.replace("&", "&amp;")
    |> String.replace("\"", "&quot;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
  end
end
