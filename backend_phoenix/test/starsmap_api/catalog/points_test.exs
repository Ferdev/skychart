defmodule StarsmapApi.Catalog.PointsTest do
  use StarsmapApi.DataCase, async: false

  import Ecto.Query

  alias StarsmapApi.Catalog.CatalogSourceObject
  alias StarsmapApi.Catalog.PointQueries
  alias StarsmapApi.Catalog.PointTileCache
  alias StarsmapApi.Catalog.SnapshotStore
  alias StarsmapApi.Repo

  setup do
    PointTileCache.clear()
    on_exit(fn -> PointTileCache.clear() end)
  end

  test "points_binary serves Gaia point-layer tiles without requiring per-row colors" do
    insert_object!("gaia-a", "gaia_500pc_stars", 1.0, 2.0, nil)
    insert_object!("gaia-b", "gaia_10kpc_bright_stars", 3.0, 4.0, "#ff0000")

    assert {:ok, payload} =
             PointQueries.points_binary(%{
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

    assert {:ok, first_payload} = PointQueries.points_binary(params)
    assert first_payload.returned == 1
    assert first_payload.cache_status == :miss

    insert_object!("gaia-b", "gaia_500pc_stars", 3.0, 4.0, nil)

    assert {:ok, cached_payload} = PointQueries.points_binary(params)
    assert cached_payload.returned == 1
    assert cached_payload.binary == first_payload.binary
    assert cached_payload.cache_status == :hit

    PointTileCache.clear()

    assert {:ok, refreshed_payload} = PointQueries.points_binary(params)
    assert refreshed_payload.returned == 2
    assert refreshed_payload.cache_status == :miss
  end

  test "points_binary can hash-sample dense Gaia point-layer tiles" do
    Enum.each(1..200, fn index ->
      insert_object!("gaia-sample-#{index}", "gaia_500pc_stars", index, index, nil)
    end)

    expected_count =
      CatalogSourceObject
      |> where(
        [object],
        fragment("mod(hashtext(?)::bigint + 2147483648, 1024) < ?", object.key, 128)
      )
      |> Repo.aggregate(:count)

    assert expected_count > 0
    assert expected_count < 200

    assert {:ok, payload} =
             PointQueries.points_binary(%{
               "min_x_au" => "0",
               "max_x_au" => "250",
               "min_y_au" => "0",
               "max_y_au" => "250",
               "groups" => "gaia_500pc_stars",
               "limit" => "500",
               "sample_buckets" => "128"
             })

    assert payload.returned == expected_count
  end

  test "sky returns normalized 3D directions and removes the observer" do
    insert_object!("observer", "gaia_500pc_stars", 10.0, 20.0, "#ffffff", 30.0)
    insert_object!("target", "gaia_500pc_stars", 11.0, 22.0, "#ffcc88", 32.0)
    insert_object!("flat-only", "gaia_500pc_stars", 12.0, 24.0, nil)

    assert {:ok, payload} =
             PointQueries.sky(%{
               "observer_key" => "observer",
               "observer_x_au" => "10",
               "observer_y_au" => "20",
               "observer_z_au" => "30",
               "groups" => "gaia_500pc_stars",
               "limit" => "10"
             })

    assert payload.returned == 1
    assert [point] = payload.points
    assert point.key == "target"
    assert_in_delta point.direction.x, 1.0 / 3.0, 1.0e-12
    assert_in_delta point.direction.y, 2.0 / 3.0, 1.0e-12
    assert_in_delta point.direction.z, 2.0 / 3.0, 1.0e-12
  end

  test "sky requires all three observer coordinates" do
    assert {:error, {:missing_param, "observer_z_au"}} =
             PointQueries.sky(%{"observer_x_au" => "0", "observer_y_au" => "0"})
  end

  defp insert_object!(key, group, x_au, y_au, color, z_au \\ nil) do
    SnapshotStore.upsert_source_objects([
      %{
        key: key,
        name: key,
        object_type: "star",
        catalog_group: group,
        source_type: "gaia_dr3",
        position_model: "catalog_coordinates",
        search_text: key,
        aliases: [],
        external_ids: %{},
        facts: %{},
        source: %{},
        x_au: x_au,
        y_au: y_au,
        z_au: z_au,
        color: color
      }
    ])
  end
end
