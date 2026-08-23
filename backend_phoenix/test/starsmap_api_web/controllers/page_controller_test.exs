defmodule StarsmapApiWeb.PageControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  setup do
    original_manifest_url = System.get_env("CATALOG_TILE_MANIFEST_URL")

    on_exit(fn ->
      if original_manifest_url do
        System.put_env("CATALOG_TILE_MANIFEST_URL", original_manifest_url)
      else
        System.delete_env("CATALOG_TILE_MANIFEST_URL")
      end
    end)
  end

  test "injects the same-origin catalog tile manifest proxy URL", %{conn: conn} do
    System.put_env(
      "CATALOG_TILE_MANIFEST_URL",
      "https://cdn.example.test/catalog-tiles/v1/manifest.json?cache=short&env=prod"
    )

    conn = get(conn, ~p"/")

    assert html_response(conn, 200) =~
             ~s(<meta name="catalog-tile-manifest-url" content="/catalog-tiles/v1/manifest.json">)
  end

  test "embed shell carries an explicit boot marker and permissive framing policy", %{conn: conn} do
    conn = get(conn, ~p"/embed?v=1&c=0,0&z=24&t=now&L=")
    html = html_response(conn, 200)

    assert html =~ ~s(<meta name="cosmic-atlas-boot-mode" content="embed">)
    assert get_resp_header(conn, "content-security-policy") == ["frame-ancestors *"]
    assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
    assert get_resp_header(conn, "referrer-policy") == ["strict-origin-when-cross-origin"]
    assert get_resp_header(conn, "x-frame-options") == []
  end

  test "normal pages remain same-origin frame protected", %{conn: conn} do
    conn = get(conn, ~p"/")
    assert get_resp_header(conn, "content-security-policy") == ["frame-ancestors 'self'"]
    assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
    assert get_resp_header(conn, "x-frame-options") == ["SAMEORIGIN"]
  end

  test "renders all required attribution families", %{conn: conn} do
    html = conn |> get(~p"/about") |> html_response(200)

    for credit <- [
          "ESA / Gaia / DPAC",
          "DESI DR1",
          "DESI Legacy Imaging Surveys DR11",
          "NASA Exoplanet Archive",
          "SIMBAD / CDS",
          "BASS DR2 / VizieR",
          "OpenNGC",
          "JPL SSD / Horizons",
          "International Astronomical Union",
          "NAIF"
        ],
        do: assert(html =~ credit)
  end

  test "forced Sentry hook is available only through compiled dev routes", %{conn: conn} do
    assert %{"ok" => true} = conn |> get(~p"/__dev__/sentry-test") |> json_response(200)
  end

  test "Vite manifest resolver returns the hashed production entry" do
    entry = StarsmapApiWeb.AssetResolver.entry()
    assert String.starts_with?(entry.script, "/assets/index-")
    assert Enum.any?(entry.css, &String.starts_with?(&1, "/assets/index-"))
  end
end
