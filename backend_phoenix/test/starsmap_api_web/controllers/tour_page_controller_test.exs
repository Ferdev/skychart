defmodule StarsmapApiWeb.TourPageControllerTest do
  use StarsmapApiWeb.ConnCase, async: true

  test "renders tour index and factual step list", %{conn: conn} do
    site_url = StarsmapApiWeb.Endpoint.url()
    index = conn |> get(~p"/tours") |> html_response(200)
    assert index =~ "Earth to the edge of the observable universe"
    assert index =~ "<title>Guided tours — Cosmic Atlas</title>"

    assert index =~
             ~s(<meta name="description" content="Narrated journeys through Cosmic Atlas.">)

    assert index =~ ~s(<link rel="canonical" href="#{site_url}/tours">)
    refute index =~ ~s(<link rel="canonical" href="https://skychart.org/">)

    page = conn |> recycle() |> get(~p"/tours/near-the-sun") |> html_response(200)
    assert page =~ "Positions move with time"
    assert page =~ "proper-motion vector"
    assert page =~ "<title>What is actually near the Sun — Cosmic Atlas</title>"

    assert page =~
             ~s(<meta name="description" content="A catalog-grounded look at the nearby stellar neighborhood and known planetary hosts.">)

    assert page =~ ~s(<link rel="canonical" href="#{site_url}/tours/near-the-sun">)
    refute page =~ ~s(<link rel="canonical" href="https://skychart.org/">)
  end

  test "allowlist rejects unknown and traversal slugs", %{conn: conn} do
    assert conn |> get("/tours/not-a-tour") |> html_response(404) =~ "Tour not found"

    assert_raise Plug.Static.InvalidPathError, fn ->
      conn |> recycle() |> get("/tours/..%2Fscience_semantics")
    end
  end

  test "each published tour uses its own title, description, and canonical URL", %{conn: conn} do
    site_url = StarsmapApiWeb.Endpoint.url()

    for slug <- ~w(earth-to-observable-universe near-the-sun) do
      tour =
        Application.app_dir(:starsmap_api, "priv/static/tours/#{slug}.json")
        |> File.read!()
        |> Jason.decode!()

      page = conn |> recycle() |> get("/tours/#{slug}") |> html_response(200)

      assert page =~ "<title>#{tour["title"]} — Cosmic Atlas</title>"
      assert page =~ ~s(<meta name="description" content="#{tour["description"]}">)
      assert page =~ ~s(<link rel="canonical" href="#{site_url}/tours/#{slug}">)
      assert length(Regex.scan(~r/<link rel="canonical"/, page)) == 1
    end
  end
end
