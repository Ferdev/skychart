defmodule StarsmapApi.Catalog.TargetMatchTest do
  use StarsmapApi.DataCase, async: false
  alias StarsmapApi.AgentSkyFixtures
  alias StarsmapApi.Catalog.{SnapshotStore, TargetMatch}

  setup do
    AgentSkyFixtures.seed_catalog()

    SnapshotStore.upsert_source_objects([
      %{
        key: "m42",
        name: "M42 Orion Nebula",
        object_type: "nebula",
        catalog_group: "messier_deep_sky",
        source_type: "deep_sky_catalog",
        position_model: "fixed_catalog_vector",
        search_text: "m42 orion nebula",
        aliases: ["M42", "Messier 42", "Orion Nebula"],
        source: %{"label" => "AstroPixels Messier Catalog", "url" => "https://astropixels.com/"},
        ra_deg: 83.82,
        dec_deg: -5.39,
        x_au: 1.0,
        y_au: 2.0,
        z_au: 3.0
      },
      %{
        key: "orion-star",
        name: "Orion test star",
        object_type: "star",
        catalog_group: "bright_stars",
        source_type: "bright_star_catalog",
        position_model: "fixed_catalog_vector",
        search_text: "orion test star",
        aliases: [],
        ra_deg: 359.999,
        dec_deg: 0.0,
        x_au: 1.0,
        y_au: 2.0,
        z_au: 3.0
      }
    ])

    :ok
  end

  defp match(rows, options \\ []) do
    {:ok, payload} = TargetMatch.run(rows, options)
    payload.rows
  end

  defp star(key, ra, dec) do
    %{
      key: key,
      name: key,
      object_type: "star",
      catalog_group: "bright_stars",
      source_type: "bright_star_catalog",
      position_model: "fixed_catalog_vector",
      search_text: key,
      aliases: [],
      ra_deg: ra,
      dec_deg: dec,
      x_au: 1.0,
      y_au: 2.0,
      z_au: 3.0
    }
  end

  # More rows than a query can read, and the closest row is last by insert order and by right ascension.
  defp seed_dense_field(first_ra, closest_ra, dec) do
    fillers = for index <- 1..2_100, do: star("filler-#{index}", first_ra + index * 1.0e-4, dec)

    fillers
    |> Enum.chunk_every(500)
    |> Enum.each(&SnapshotStore.upsert_source_objects/1)

    SnapshotStore.upsert_source_objects([star("closest", closest_ra, dec)])
  end

  test "designations, aliases, and keys resolve to one object" do
    for name <- ["M 42", "m42", "Messier 42", "M042", "Orion Nebula"] do
      assert [%{status: "matched", object: %{key: "m42"}}] = match([%{"name" => name}])
    end

    assert [%{status: "matched", object: %{key: "ngc-224"}}] = match([%{"name" => "NGC 224"}])
    assert [%{status: "matched", object: %{key: "m42"}}] = match([%{"key" => "m42"}])
  end

  test "a name with several results is ambiguous and has candidates" do
    assert [%{status: "ambiguous", candidates: candidates}] = match([%{"name" => "Orion"}])
    assert length(candidates) > 1
    assert Enum.all?(candidates, &(is_binary(&1.key) and is_binary(&1.name)))
  end

  test "a misspelled name is unmatched, and an invalid row keeps its place" do
    rows =
      match([%{"name" => "Andromdea"}, %{"nope" => 1}, %{"name" => "   "}, %{"name" => "M 42"}])

    assert Enum.map(rows, & &1.status) == ["unmatched", "unmatched", "unmatched", "matched"]
    assert Enum.map(rows, & &1.row) == [0, 1, 2, 3]
    assert Enum.at(rows, 1).reason == "invalid_row"
  end

  test "repeated rows and two names of one object are marked" do
    rows =
      match([
        %{"name" => "M 42"},
        %{"name" => "M 42"},
        %{"name" => "Orion Nebula"},
        %{"name" => "NGC 224"}
      ])

    assert Enum.map(rows, &Map.get(&1, :duplicate_of)) == [nil, 0, 0, nil]
  end

  test "the Messier and OpenNGC rows of one object are one object" do
    SnapshotStore.upsert_source_objects([
      %{
        key: "ngc-1976",
        name: "NGC 1976 Orion Nebula",
        object_type: "nebula",
        catalog_group: "ngc_ic_deep_sky",
        source_type: "openngc_ngc_ic_catalog",
        position_model: "fixed_catalog_vector",
        search_text: "ngc 1976",
        aliases: [],
        ra_deg: 83.8221,
        dec_deg: -5.3911
      }
    ])

    assert [nil, 0] =
             match([%{"name" => "M 42"}, %{"name" => "NGC 1976"}])
             |> Enum.map(&Map.get(&1, :duplicate_of))
  end

  test "a match has the label and the address of its source" do
    [row] = match([%{"name" => "M 42"}])

    assert row.object.source == %{
             label: "AstroPixels Messier Catalog",
             url: "https://astropixels.com/"
           }
  end

  test "a position gives the nearest object and the separation" do
    assert [row] = match([%{"ra_deg" => 83.8325, "dec_deg" => -5.4}])
    assert row.status == "matched"
    assert row.object.key == "m42"
    # 0.0125 degrees of right ascension at this declination and 0.01 degrees of declination.
    expected = :math.sqrt((0.0125 * :math.cos(5.395 * :math.pi() / 180)) ** 2 + 0.01 ** 2) * 3600
    assert_in_delta row.separation_arcsec, expected, 0.01
  end

  test "the Andromeda galaxy is at the right separation from its published center" do
    # NGC 224 from the fixture, and the same position 30 arcseconds north.
    assert [row] = match([%{"ra_deg" => 10.684, "dec_deg" => 41.269 + 30 / 3600}])
    assert_in_delta row.separation_arcsec, 30.0, 0.001
  end

  test "a position across right ascension zero finds the object" do
    assert [%{status: "matched", object: %{key: "orion-star"}}] =
             match([%{"ra_deg" => 0.001, "dec_deg" => 0.0}])
  end

  test "a position with no object in the radius is unmatched" do
    assert [%{status: "unmatched"}] = match([%{"ra_deg" => 200.0, "dec_deg" => 10.0}])

    assert [%{status: "unmatched"}] =
             match([%{"ra_deg" => 84.2, "dec_deg" => -5.39}], radius_arcmin: 1)

    assert [%{status: "matched"}] =
             match([%{"ra_deg" => 84.2, "dec_deg" => -5.39}], radius_arcmin: 30)
  end

  test "a dense field gives the nearest object" do
    seed_dense_field(120.0, 120.5, 20.0)

    assert [%{status: "matched", object: %{key: "closest"}, separation_arcsec: separation}] =
             match([%{"ra_deg" => 120.5001, "dec_deg" => 20.0}], radius_arcmin: 60)

    assert_in_delta separation, 0.0001 * :math.cos(20 * :math.pi() / 180) * 3600, 0.001
  end

  test "a dense field across right ascension zero gives the nearest object" do
    seed_dense_field(359.5, 359.9999, 30.0)

    assert [%{status: "matched", object: %{key: "closest"}}] =
             match([%{"ra_deg" => 0.0002, "dec_deg" => 30.0}], radius_arcmin: 60)
  end

  test "a dense field above right ascension zero gives the nearest object" do
    seed_dense_field(0.1, 0.5, 40.0)

    assert [%{status: "matched", object: %{key: "closest"}}] =
             match([%{"ra_deg" => 0.5001, "dec_deg" => 40.0}], radius_arcmin: 60)
  end

  test "two objects at one position give the first key" do
    SnapshotStore.upsert_source_objects([star("same-b", 150.0, 10.0)])
    SnapshotStore.upsert_source_objects([star("same-a", 150.0, 10.0)])

    assert [%{object: %{key: "same-a"}}] = match([%{"ra_deg" => 150.001, "dec_deg" => 10.0}])
  end

  test "a lookup that the timeout stopped has the time budget reason" do
    assert [%{status: "unmatched", reason: "time_budget"}] =
             match([%{"ra_deg" => 83.82, "dec_deg" => -5.39}], task_timeout_ms: 0)
  end

  test "an object that is not in the catalog has no reason" do
    assert [row] = match([%{"name" => "Andromdea"}])
    assert row.status == "unmatched"
    refute Map.has_key?(row, :reason)

    assert [position] = match([%{"ra_deg" => 200.0, "dec_deg" => 10.0}])
    assert position.status == "unmatched"
    refute Map.has_key?(position, :reason)
  end

  test "the row limit refuses an oversized request" do
    rows = List.duplicate(%{"name" => "M 42"}, 501)
    assert {:error, {:too_many_rows, 500}} = TargetMatch.run(rows)
    assert {:error, {:too_many_rows, 3}} = TargetMatch.run(Enum.take(rows, 4), max_rows: 3)
    assert {:error, :invalid_rows} = TargetMatch.run([])
    assert {:error, :invalid_rows} = TargetMatch.run("M 42")
  end

  test "a designation has one key form" do
    assert TargetMatch.designation_keys("IC 434") == ["ic-434"]
    assert TargetMatch.designation_keys("NGC0224") == ["ngc-224"]
    assert TargetMatch.designation_keys("hip 32349") == ["hip-32349"]
    assert TargetMatch.designation_keys("Vega") == ["vega"]
  end
end
