defmodule StarsmapApi.Catalog.UnknownPositionTest do
  use StarsmapApi.DataCase
  alias StarsmapApi.Catalog.{Importer, SnapshotStore, PublicObjects, PointQueries}

  test "unknown-distance OpenNGC and coordinate-missing metadata import and resolve" do
    angular =
      Importer.attrs_for_entry!(
        {:ngc_ic_deep_sky,
         %{
           "key" => "ngc-unknown",
           "name" => "Unknown nebula",
           "object_type" => "nebula",
           "ra_deg" => 90.0,
           "dec_deg" => 0.0,
           "distance_quality" => "not_available"
         }}
      )

    metadata =
      Importer.attrs_for_entry!(
        {:deep_sky,
         %{
           "key" => "metadata-only",
           "name" => "Metadata only",
           "object_type" => "nebula"
         }}
      )

    assert angular.x_au == nil
    assert angular.radius_km == nil
    assert Importer.import_report([angular, metadata]).valid?
    SnapshotStore.upsert_objects([angular, metadata])
    assert {:ok, payload} = PublicObjects.get_by_key("ngc-unknown")
    assert payload.capabilities.angular_position
    refute payload.capabilities.spatial_position
    assert payload.astrometry.distance_pc == nil
    assert {:ok, missing} = PublicObjects.get_by_key("metadata-only")
    refute missing.capabilities.angular_position

    assert {:ok, sky} =
             PointQueries.sky(%{
               "observer_x_au" => "0",
               "observer_y_au" => "0",
               "observer_z_au" => "0"
             })

    assert [point] = sky.points
    assert point.key == "ngc-unknown"
    assert point.direction_model == "catalog_angular_no_parallax"
    assert_in_delta point.direction.x, 0, 1.0e-12
    assert point.direction.z < 0
  end

  test "a reference shell is never returned as physical distance" do
    row =
      Importer.attrs_for_entry!(
        {:deep_sky,
         %{
           "key" => "shell",
           "name" => "Shell",
           "ra_deg" => 0,
           "dec_deg" => 0,
           "distance_pc" => 1.0e9
         }}
      )

    SnapshotStore.upsert_objects([%{row | position_model: "catalog_sky_position_reference_shell"}])

    assert {:ok, payload} = PublicObjects.get_by_key("shell")
    assert payload.position.x_au == nil
    assert payload.astrometry.distance_pc == nil
    refute payload.capabilities.spatial_position
  end

  test "distance evidence survives absent direction and angular validation is independent" do
    row =
      Importer.attrs_for_entry!(
        {:deep_sky, %{"key" => "distance-only", "name" => "Distance only", "distance_pc" => 10}}
      )

    SnapshotStore.upsert_objects([row])
    assert {:ok, payload} = PublicObjects.get_by_key("distance-only")
    assert payload.astrometry.distance_pc == 10
    assert payload.position.x_au == nil
    refute payload.capabilities.angular_position
    refute payload.capabilities.spatial_position

    assert_raise ArgumentError, "catalog coordinates out of range", fn ->
      Importer.attrs_for_entry!(
        {:deep_sky, %{"key" => "invalid", "name" => "Invalid direction", "ra_deg" => 360}}
      )
    end
  end
end
