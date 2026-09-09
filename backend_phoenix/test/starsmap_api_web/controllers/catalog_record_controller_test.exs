defmodule StarsmapApiWeb.CatalogRecordControllerTest do
  use StarsmapApiWeb.ConnCase
  alias StarsmapApi.Catalog.RecordStore

  test "source records resolve locally with lossless IDs and null measurements", %{conn: conn} do
    record = %{
      "provider" => "test",
      "catalog" => "angular",
      "release" => "r1",
      "source_id" => "18446744073709551615",
      "name" => "Unresolved detection",
      "documentation" => "fixture:unavailable-upstream",
      "astrometry" => %{"ra_deg" => nil},
      "measurements" => [%{"field" => "parallax", "value" => nil, "unit" => "mas"}]
    }

    key = RecordStore.put_record!(record)
    response = conn |> get("/api/catalog/records/#{key}") |> json_response(200)
    assert response["record"]["source_id"] == record["source_id"]
    assert response["record"]["measurements"] == record["measurements"]
    assert response["record"]["capabilities"]["searchable_metadata"]
    refute response["record"]["capabilities"]["angular_position"]
  end

  test "unknown record fails explicitly", %{conn: conn} do
    assert conn |> get("/api/catalog/records/unknown") |> json_response(404) == %{
             "error" => "not_found"
           }
  end
end
