defmodule StarsmapApiWeb.CatalogTileProxyControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  defmodule DirectBodyHttpClient do
    def request(:get, url, _headers, <<>>, options) do
      send(self(), {:catalog_tile_request, url, options})

      manifest =
        Jason.encode!(%{
          "version" => "v10",
          "layers" => [
            %{
              "id" => "gaia_stars",
              "tile_url_template" =>
                "https://cdn.example.test/catalog-tiles/v10/layers/gaia_stars/s{span_log2}/x{x}/y{y}.bin"
            }
          ]
        })

      {:ok, 200, [{"content-type", "application/json"}], manifest}
    end
  end

  setup do
    original_manifest_url = System.get_env("CATALOG_TILE_MANIFEST_URL")
    original_http_client = Application.get_env(:starsmap_api, :catalog_tile_http_client)

    System.put_env(
      "CATALOG_TILE_MANIFEST_URL",
      "https://cdn.example.test/catalog-tiles/v10/manifest.json"
    )

    Application.put_env(
      :starsmap_api,
      :catalog_tile_http_client,
      DirectBodyHttpClient
    )

    on_exit(fn ->
      restore_system_env("CATALOG_TILE_MANIFEST_URL", original_manifest_url)
      restore_application_env(:catalog_tile_http_client, original_http_client)
    end)
  end

  test "proxies the direct response body returned by Hackney 4", %{conn: conn} do
    conn = get(conn, ~p"/catalog-tiles/v1/manifest.json")

    assert %{
             "version" => "v10",
             "layers" => [
               %{
                 "id" => "gaia_stars",
                 "tile_url_template" =>
                   "/catalog-tiles/v1/layers/gaia_stars/s{span_log2}/x{x}/y{y}.bin"
               }
             ]
           } = json_response(conn, 200)

    assert_received {:catalog_tile_request,
                     "https://cdn.example.test/catalog-tiles/v10/manifest.json", options}

    assert options[:follow_redirect]
    assert options[:recv_timeout] == 30_000
    assert get_resp_header(conn, "cache-control") == ["no-store"]
    assert get_resp_header(conn, "access-control-allow-origin") == ["*"]
  end

  defp restore_system_env(key, nil), do: System.delete_env(key)
  defp restore_system_env(key, value), do: System.put_env(key, value)

  defp restore_application_env(key, nil), do: Application.delete_env(:starsmap_api, key)
  defp restore_application_env(key, value), do: Application.put_env(:starsmap_api, key, value)
end
