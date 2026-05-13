defmodule StarsmapApiWeb.PageController do
  use StarsmapApiWeb, :controller

  def index(conn, _params) do
    index_path = Application.app_dir(:starsmap_api, "priv/static/index.html")

    if File.regular?(index_path) do
      conn
      |> put_resp_content_type("text/html")
      |> send_file(200, index_path)
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
end
