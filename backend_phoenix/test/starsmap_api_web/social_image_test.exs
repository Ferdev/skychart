defmodule StarsmapApiWeb.SocialImageTest do
  use StarsmapApiWeb.ConnCase, async: false

  @project_root Path.expand("../../..", __DIR__)

  test "the home page shares a 1200 x 630 PNG that the endpoint serves", %{conn: conn} do
    source = Path.join(@project_root, "public/og-image.png")
    png = File.read!(source)

    # The PNG header gives the size: the IHDR chunk holds the width and the height.
    assert <<137, "PNG", 13, 10, 26, 10, _length::32, "IHDR", 1200::32, 630::32, _::binary>> =
             png

    index = File.read!(Path.join(@project_root, "index.html"))
    assert index =~ ~s(<meta property="og:image" content="https://skychart.org/og-image.png" />)
    assert index =~ ~s(<meta property="og:image:width" content="1200" />)
    assert index =~ ~s(<meta property="og:image:height" content="630" />)
    assert index =~ ~s(<meta property="og:image:alt" content=")

    # `npm run build:phoenix` copies the file. Without a build, the test puts it there.
    served = Application.app_dir(:starsmap_api, "priv/static/og-image.png")

    unless File.exists?(served) do
      File.cp!(source, served)
      on_exit(fn -> File.rm(served) end)
    end

    image = get(conn, "/og-image.png")
    assert response(image, 200) == File.read!(served)
    assert get_resp_header(image, "content-type") == ["image/png"]
  end
end
