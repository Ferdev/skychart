defmodule StarsmapApiWeb.UniverseAssetsTest do
  use StarsmapApiWeb.ConnCase, async: false

  test "the production endpoint serves nested appearance maps and their credits", %{conn: conn} do
    name = "universe-test-#{System.unique_integer([:positive])}"
    directory = Application.app_dir(:starsmap_api, "priv/static/textures/#{name}")
    File.mkdir_p!(directory)
    on_exit(fn -> File.rm_rf!(directory) end)

    # A complete 1x1 PNG exercises the same endpoint and MIME handling as maps.
    png =
      Base.decode64!(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII="
      )

    File.write!(Path.join(directory, "surface.png"), png)
    File.write!(Path.join(directory, "credits.html"), "<p>Appearance sources and credits</p>")

    image = get(conn, "/textures/#{name}/surface.png")
    assert response(image, 200) == png
    assert get_resp_header(image, "content-type") == ["image/png"]

    credits = get(build_conn(), "/textures/#{name}/credits.html")
    assert html_response(credits, 200) =~ "Appearance sources and credits"
  end
end
