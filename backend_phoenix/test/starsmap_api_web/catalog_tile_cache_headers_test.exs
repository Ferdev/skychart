defmodule StarsmapApiWeb.CatalogTileCacheHeadersTest do
  use ExUnit.Case, async: true

  import Plug.Test

  alias StarsmapApiWeb.{CatalogTileProxyController, Endpoint}

  test "versionless manifests are never cached across a rollover" do
    assert %{"cache-control" => "no-store"} =
             Endpoint.catalog_tile_cache_headers(conn(:get, "/catalog-tiles/v1/manifest.json"))

    assert CatalogTileProxyController.cache_control_for_path(["manifest.json"]) == "no-store"
  end

  test "versioned tile binaries remain immutable" do
    assert %{"cache-control" => "public, max-age=31536000, immutable"} =
             Endpoint.catalog_tile_cache_headers(conn(:get, "/catalog-tiles/v9/tile.bin"))

    assert CatalogTileProxyController.cache_control_for_path(["layers", "gaia", "tile.bin"]) ==
             "public, max-age=31536000, immutable"
  end
end
