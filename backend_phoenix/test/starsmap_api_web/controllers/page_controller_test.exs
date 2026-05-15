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
end
