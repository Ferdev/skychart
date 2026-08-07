defmodule StarsmapApi.Catalog.SearchTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Catalog.Search
  alias StarsmapApi.Catalog.SnapshotStore

  test "search returns one extra row only to infer has_more" do
    insert_object!("gaia-a", "Gaia Alpha")
    insert_object!("gaia-b", "Gaia Beta")
    insert_object!("gaia-c", "Gaia Gamma")

    payload = Search.search(%{"q" => "gaia", "limit" => "2"})

    assert payload.has_more
    assert payload.total == 3
    assert length(payload.objects) == 2
  end

  test "search text includes the object key and name" do
    insert_object!("jupiter", "Jupiter")

    payload = Search.search(%{"q" => "jupiter", "limit" => "10"})

    assert Enum.map(payload.objects, & &1.key) == ["jupiter"]
  end

  test "short interactive queries return immediately without scanning the catalog" do
    insert_object!("jupiter", "Jupiter")

    payload = Search.search(%{"q" => "ju", "limit" => "10"})

    assert payload.objects == []
    refute payload.has_more
  end

  test "a ranked-search timeout falls back to magnitude ordering instead of failing" do
    insert_object!("jupiter", "Jupiter")
    previous = Application.get_env(:starsmap_api, :catalog_search_timeout_ms)
    Application.put_env(:starsmap_api, :catalog_search_timeout_ms, 1)

    try do
      payload = Search.search(%{"q" => "jupiter", "limit" => "10"})
      assert Enum.map(payload.objects, & &1.key) == ["jupiter"]
    after
      if previous,
        do: Application.put_env(:starsmap_api, :catalog_search_timeout_ms, previous),
        else: Application.delete_env(:starsmap_api, :catalog_search_timeout_ms)
    end
  end

  defp insert_object!(key, name) do
    SnapshotStore.upsert_source_objects([
      %{
        key: key,
        name: name,
        object_type: "star",
        catalog_group: "gaia_500pc_stars",
        source_type: "gaia_dr3",
        position_model: "catalog_coordinates",
        search_text: "#{key} #{String.downcase(name)} star gaia",
        aliases: [],
        external_ids: %{},
        facts: %{},
        source: %{},
        x_au: 1.0,
        y_au: 2.0
      }
    ])
  end
end
