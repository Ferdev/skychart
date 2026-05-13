defmodule StarsmapApi.Catalog.PointsTest do
  use StarsmapApi.DataCase, async: false

  alias StarsmapApi.Catalog
  alias StarsmapApi.Catalog.CatalogObject
  alias StarsmapApi.Catalog.PointTileCache
  alias StarsmapApi.Repo

  setup do
    PointTileCache.clear()
    on_exit(fn -> PointTileCache.clear() end)
  end

  test "points_binary serves Gaia point-layer tiles without requiring per-row colors" do
    insert_object!("gaia-a", "gaia_500pc_stars", 1.0, 2.0, nil)
    insert_object!("gaia-b", "gaia_10kpc_bright_stars", 3.0, 4.0, "#ff0000")

    assert {:ok, payload} =
             Catalog.points_binary(%{
               "min_x_au" => "0",
               "max_x_au" => "5",
               "min_y_au" => "0",
               "max_y_au" => "5",
               "groups" => "gaia_500pc_stars,gaia_10kpc_bright_stars",
               "limit" => "10"
             })

    assert payload.returned == 2
    assert <<"SMP2", 2::little-unsigned-integer-size(32), records::binary>> = payload.binary
    assert byte_size(records) == 24
    assert payload.cache_status == :miss
  end

  test "points_binary reuses cached tile payloads until the cache is cleared" do
    params = %{
      "min_x_au" => "0",
      "max_x_au" => "5",
      "min_y_au" => "0",
      "max_y_au" => "5",
      "groups" => "gaia_500pc_stars",
      "limit" => "10"
    }

    insert_object!("gaia-a", "gaia_500pc_stars", 1.0, 2.0, nil)

    assert {:ok, first_payload} = Catalog.points_binary(params)
    assert first_payload.returned == 1
    assert first_payload.cache_status == :miss

    insert_object!("gaia-b", "gaia_500pc_stars", 3.0, 4.0, nil)

    assert {:ok, cached_payload} = Catalog.points_binary(params)
    assert cached_payload.returned == 1
    assert cached_payload.binary == first_payload.binary
    assert cached_payload.cache_status == :hit

    PointTileCache.clear()

    assert {:ok, refreshed_payload} = Catalog.points_binary(params)
    assert refreshed_payload.returned == 2
    assert refreshed_payload.cache_status == :miss
  end

  defp insert_object!(key, group, x_au, y_au, color) do
    %CatalogObject{}
    |> CatalogObject.changeset(%{
      key: key,
      name: key,
      object_type: "star",
      catalog_group: group,
      source_type: "gaia_catalog",
      position_model: "catalog_coordinates",
      search_text: key,
      x_au: x_au,
      y_au: y_au,
      color: color
    })
    |> Repo.insert!()
  end
end
