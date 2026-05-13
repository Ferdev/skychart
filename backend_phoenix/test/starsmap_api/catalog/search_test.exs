defmodule StarsmapApi.Catalog.SearchTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Catalog
  alias StarsmapApi.Catalog.CatalogObject
  alias StarsmapApi.Repo

  test "search returns one extra row only to infer has_more" do
    insert_object!("gaia-a", "Gaia Alpha")
    insert_object!("gaia-b", "Gaia Beta")
    insert_object!("gaia-c", "Gaia Gamma")

    payload = Catalog.search(%{"q" => "gaia", "limit" => "2"})

    assert payload.has_more
    assert payload.total == 3
    assert length(payload.objects) == 2
  end

  test "search text includes the object key and name" do
    insert_object!("jupiter", "Jupiter")

    payload = Catalog.search(%{"q" => "jupiter", "limit" => "10"})

    assert Enum.map(payload.objects, & &1.key) == ["jupiter"]
  end

  test "short interactive queries return immediately without scanning the catalog" do
    insert_object!("jupiter", "Jupiter")

    payload = Catalog.search(%{"q" => "ju", "limit" => "10"})

    assert payload.objects == []
    refute payload.has_more
  end

  defp insert_object!(key, name) do
    %CatalogObject{}
    |> CatalogObject.changeset(%{
      key: key,
      name: name,
      object_type: "star",
      catalog_group: "gaia_500pc_stars",
      source_type: "gaia_catalog",
      position_model: "catalog_coordinates",
      search_text: "#{key} #{String.downcase(name)} star gaia",
      x_au: 1.0,
      y_au: 2.0
    })
    |> Repo.insert!()
  end
end
