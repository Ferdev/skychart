defmodule StarsmapApi.Catalog.PointsTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Catalog
  alias StarsmapApi.Catalog.CatalogObject
  alias StarsmapApi.Repo

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
