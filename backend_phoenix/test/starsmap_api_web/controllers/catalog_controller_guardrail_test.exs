defmodule StarsmapApiWeb.CatalogControllerGuardrailTest do
  use StarsmapApiWeb.ConnCase, async: false

  setup do
    original_manifest_url = System.get_env("CATALOG_TILE_MANIFEST_URL")
    original_dynamic_fallback = System.get_env("CATALOG_DYNAMIC_POINT_FALLBACK")
    original_default = Application.get_env(:starsmap_api, :dynamic_point_fallback_default_enabled)

    on_exit(fn ->
      restore_env("CATALOG_TILE_MANIFEST_URL", original_manifest_url)
      restore_env("CATALOG_DYNAMIC_POINT_FALLBACK", original_dynamic_fallback)

      Application.put_env(
        :starsmap_api,
        :dynamic_point_fallback_default_enabled,
        original_default
      )
    end)
  end

  test "dynamic point tiles are disabled when a static manifest is configured", %{conn: conn} do
    System.put_env(
      "CATALOG_TILE_MANIFEST_URL",
      "https://cdn.example.test/catalog-tiles/v1/manifest.json"
    )

    System.delete_env("CATALOG_DYNAMIC_POINT_FALLBACK")

    conn = get(conn, ~p"/api/catalog/points.bin")

    assert json_response(conn, 404) == %{"error" => "dynamic_point_fallback_disabled"}
  end

  test "dynamic point tiles remain explicit opt-in for emergency fallback", %{conn: conn} do
    System.put_env(
      "CATALOG_TILE_MANIFEST_URL",
      "https://cdn.example.test/catalog-tiles/v1/manifest.json"
    )

    System.put_env("CATALOG_DYNAMIC_POINT_FALLBACK", "1")

    conn = get(conn, ~p"/api/catalog/points.bin")

    assert json_response(conn, 400)["error"] == "missing_param"
  end

  test "dynamic point tiles are disabled when the runtime default disables fallback", %{
    conn: conn
  } do
    System.delete_env("CATALOG_TILE_MANIFEST_URL")
    System.delete_env("CATALOG_DYNAMIC_POINT_FALLBACK")
    Application.put_env(:starsmap_api, :dynamic_point_fallback_default_enabled, false)

    conn = get(conn, ~p"/api/catalog/points.bin")

    assert json_response(conn, 404) == %{"error" => "dynamic_point_fallback_disabled"}
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
