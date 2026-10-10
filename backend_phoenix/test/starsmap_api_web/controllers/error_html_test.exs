defmodule StarsmapApiWeb.ErrorHTMLTest do
  use StarsmapApiWeb.ConnCase, async: true
  alias StarsmapApiWeb.{ErrorHTML, StaticPage}

  test "the 404 page has the style of the static pages and a link to the atlas" do
    page = ErrorHTML.render("404.html", %{})
    assert page =~ "<h1>Page not found</h1>"
    assert page =~ ~s(<a class="back" href="/">← Back to the atlas</a>)
    assert page =~ ~s(<meta name="robots" content="noindex">)
    assert page =~ StaticPage.css()
    refute page =~ "<script"
  end

  test "other errors show the status message" do
    assert ErrorHTML.render("500.html", %{}) =~ "<h1>Internal Server Error</h1>"
  end

  test "a browser gets the styled page for an unknown address", %{conn: conn} do
    body =
      conn |> put_req_header("accept", "text/html") |> get("/no-such-page") |> html_response(404)

    assert body =~ "<h1>Page not found</h1>"
    assert body =~ "Back to the atlas"
    assert body =~ StaticPage.css()
  end

  test "an unknown API address returns JSON for each Accept header", %{conn: conn} do
    for accept <- ["application/json", "*/*", "text/html"] do
      response =
        conn |> recycle() |> put_req_header("accept", accept) |> get("/api/no-such-endpoint")

      assert json_response(response, 404) == %{"errors" => %{"detail" => "Not Found"}}
    end

    assert conn |> recycle() |> post("/api/no-such-endpoint", %{}) |> json_response(404) ==
             %{"errors" => %{"detail" => "Not Found"}}
  end

  test "object, tour, and community not-found pages use the same template", %{conn: conn} do
    for {path, heading} <- [
          {"/o/not-real", "Object not found"},
          {"/tours/not-a-tour", "Tour not found"},
          {"/community/not-a-policy", "Page not found"},
          {"/photos/00000000-0000-0000-0000-000000000000", "Photo not found"},
          {"/u/no-such-photographer", "Photographer not found"}
        ] do
      body = conn |> recycle() |> get(path) |> html_response(404)
      assert body =~ "<h1>#{heading}</h1>"
      assert body =~ ~s(<a class="back" href="/">← Back to the atlas</a>)
      assert body =~ StaticPage.css()
    end
  end

  test "the static pages use one template, one back link, and one font stack", %{conn: conn} do
    for path <- [
          "/about",
          "/agents",
          "/methodology",
          "/tours",
          "/tours/near-the-sun",
          "/community/rules"
        ] do
      body = conn |> recycle() |> get(path) |> html_response(200)
      assert body =~ StaticPage.css(), path
      assert body =~ ~s(<a class="back" href="/">← Back to the atlas</a>), path
      refute body =~ "Georgia", path
      # A static page is a page of its own: it has no application shell and no map.
      refute body =~ ~s(id="app"), path
    end
  end

  test "the static files of the repository use the same template" do
    root = Path.expand("../../../..", __DIR__)
    # `public/404.html` is the page of a static host. It is the output of the template.
    assert File.read!(Path.join(root, "public/404.html")) == StaticPage.not_found()

    credits = File.read!(Path.join(root, "public/textures/universe/credits.html"))
    assert credits =~ StaticPage.css()
    assert credits =~ ~s(<a class="back" href="/">← Back to the atlas</a>)
    assert credits =~ "3D appearance and image credits"
    refute credits =~ "Georgia"
  end

  test "the core object key match ignores the case of the letters", %{conn: conn} do
    lower = conn |> get("/o/mars") |> html_response(200)
    upper = conn |> recycle() |> get("/o/Mars") |> html_response(200)
    assert lower =~ "Mars"
    assert upper =~ "Mars"
    assert {:ok, %{key: "mars"}} = StarsmapApi.Catalog.PublicObjects.public_object("MARS")
  end
end
