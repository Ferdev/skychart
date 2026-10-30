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

  describe "POST /api/catalog/match" do
    setup do
      StarsmapApi.AgentSkyFixtures.seed_catalog()
      StarsmapApiWeb.Plugs.RateLimit.reset()
      :ok
    end

    defp match(conn, body) do
      conn
      |> put_req_header("content-type", "application/json")
      |> post("/api/catalog/match", body)
    end

    test "a batch gives one row for each input, with the source", %{conn: conn} do
      payload =
        conn |> match(%{rows: [%{name: "NGC 224"}, %{name: "Nothing"}]}) |> json_response(200)

      assert [
               %{"status" => "matched", "object" => %{"key" => "ngc-224"}},
               %{"status" => "unmatched"}
             ] = payload["rows"]

      assert payload["limit"] == 500
    end

    test "an oversized list has a clear error", %{conn: conn} do
      rows = for _ <- 1..501, do: %{name: "M31"}

      assert %{"error" => "too_many_rows", "limit" => 500} =
               conn |> match(%{rows: rows}) |> json_response(413)

      assert %{"error" => "invalid_rows"} = conn |> match(%{rows: []}) |> json_response(400)
    end

    test "the rate limit refuses a client that sends too many lists", %{conn: conn} do
      original = System.get_env("RATE_LIMIT_CAPACITY_OVERRIDE")
      System.put_env("RATE_LIMIT_CAPACITY_OVERRIDE", "1")

      on_exit(fn ->
        if original,
          do: System.put_env("RATE_LIMIT_CAPACITY_OVERRIDE", original),
          else: System.delete_env("RATE_LIMIT_CAPACITY_OVERRIDE")

        StarsmapApiWeb.Plugs.RateLimit.reset()
      end)

      assert conn |> match(%{rows: [%{name: "NGC 224"}]}) |> json_response(200)
      assert conn |> match(%{rows: [%{name: "NGC 224"}]}) |> response(429)
    end
  end
end
