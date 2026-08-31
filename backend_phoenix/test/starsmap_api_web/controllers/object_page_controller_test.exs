defmodule StarsmapApiWeb.ObjectPageControllerTest do
  use StarsmapApiWeb.ConnCase, async: false
  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.Catalog.SnapshotStore

  setup do
    StarsmapApi.Catalog.PublicCache.clear()

    SnapshotStore.upsert_source_objects([
      %{
        key: "ngc-224",
        name: "Andromeda <script>alert(1)</script>",
        aliases: ["M31"],
        object_type: "galaxy",
        catalog_group: "messier_deep_sky",
        source_type: "deep_sky_catalog",
        position_model: "heasarc_neargalcat_j2000_distance_coordinates",
        search_text: "andromeda m31",
        external_ids: %{},
        facts: %{"constellation" => "Andromeda"},
        source: %{},
        ra_deg: 10.684,
        dec_deg: 41.269,
        distance_ly: 2_537_000.0,
        apparent_magnitude: 3.44,
        x_au: 1.0,
        y_au: 2.0
      }
    ])

    :ok
  end

  test "renders useful escaped object HTML without JavaScript", %{conn: conn} do
    body = conn |> get(~p"/o/ngc-224") |> html_response(200)
    assert body =~ "Andromeda"
    assert body =~ "M31"
    assert body =~ "2.537e6 ly"
    assert body =~ "J2000 equatorial"
    assert body =~ "window.__ATLAS_BOOT__={\"objectKey\":\"ngc-224\"}"
    assert body =~ "application/ld+json"
    assert length(Regex.scan(~r/<link rel="canonical"/, body)) == 1
    assert length(Regex.scan(~r/<meta name="description"/, body)) == 1
    assert body =~ ~r/<meta property="og:url" content="https?:\/\/[^\"]+\/o\/ngc-224">/

    assert body =~
             ~r/<meta property="og:image" content="https?:\/\/[^\"]+\/object-types\/galaxy">/

    refute body =~ "<script>alert(1)</script>"
    assert body =~ "&lt;script&gt;"
  end

  test "unknown and bulk-only objects return 404", %{conn: conn} do
    assert conn |> get(~p"/o/not-real") |> html_response(404) =~ "Object not found"

    SnapshotStore.upsert_source_objects([
      %{
        key: "bulk",
        name: "Bulk",
        object_type: "star",
        catalog_group: "gaia_500pc_stars",
        source_type: "gaia_dr3",
        position_model: "catalog",
        search_text: "bulk",
        aliases: [],
        external_ids: %{},
        facts: %{},
        source: %{},
        x_au: 1.0,
        y_au: 1.0
      }
    ])

    StarsmapApi.Catalog.PublicCache.clear()
    assert conn |> recycle() |> get(~p"/o/bulk") |> html_response(404) =~ "Object not found"
  end

  test "related objects return only the public card fields in magnitude and name order" do
    SnapshotStore.upsert_source_objects([
      %{
        key: "ngc-224",
        name: "Andromeda",
        object_type: "galaxy",
        catalog_group: "related-object-test",
        source_type: "deep_sky_catalog",
        position_model: "catalog",
        search_text: "andromeda",
        aliases: [],
        external_ids: %{},
        facts: %{},
        source: %{}
      }
    ])

    related = [
      {"related-zeta", "Zeta", 1.0},
      {"related-alpha", "Alpha", 1.0},
      {"related-beta", "Beta", 2.0},
      {"related-gamma", "Gamma", 3.0},
      {"related-delta", "Delta", 4.0},
      {"related-epsilon", "Epsilon", 5.0},
      {"related-eta", "Eta", 6.0},
      {"related-no-magnitude", "No magnitude", nil}
    ]

    SnapshotStore.upsert_source_objects(
      Enum.map(related, fn {key, name, magnitude} ->
        %{
          key: key,
          name: name,
          object_type: "galaxy",
          catalog_group: "related-object-test",
          source_type: "deep_sky_catalog",
          position_model: "catalog",
          search_text: String.downcase(name),
          aliases: [],
          external_ids: %{},
          facts: %{},
          source: %{},
          apparent_magnitude: magnitude
        }
      end)
    )

    StarsmapApi.Catalog.PublicCache.clear()
    assert {:ok, object} = PublicObjects.public_object("ngc-224")

    assert Enum.map(object.related, & &1.key) == [
             "related-alpha",
             "related-zeta",
             "related-beta",
             "related-gamma",
             "related-delta",
             "related-epsilon"
           ]

    assert Enum.all?(object.related, fn related_object ->
             Map.keys(related_object) |> Enum.sort() == [:key, :name, :object_type]
           end)
  end

  test "stale OpenNGC Andromeda parallax cannot publish a false distance or position", %{
    conn: conn
  } do
    SnapshotStore.upsert_source_objects([
      %{
        key: "ngc-224",
        name: "NGC 224 Andromeda Galaxy",
        aliases: ["M31", "Andromeda Galaxy"],
        object_type: "galaxy",
        catalog_group: "ngc_ic_deep_sky",
        source_type: "openngc_ngc_ic_catalog",
        position_model: "openngc_j2000_coordinates",
        search_text: "andromeda m31",
        external_ids: %{"ngc" => "NGC 224"},
        facts: %{"distance_quality" => "parallax", "parallax_mas" => 6.0},
        source: %{},
        ra_deg: 10.68479167,
        dec_deg: 41.26905556,
        distance_pc: 166.66666667,
        distance_ly: 543.59396283,
        x_au: 1.0,
        y_au: 2.0,
        z_au: 3.0
      }
    ])

    StarsmapApi.Catalog.PublicCache.clear()
    assert {:ok, object} = PublicObjects.public_object("ngc-224")
    assert object.astrometry.distance_pc == nil
    assert object.astrometry.distance_ly == nil
    assert object.position == %{x_au: nil, y_au: nil, z_au: nil, x_km: nil, y_km: nil, z_km: nil}
    assert object.facts["distance_quality"] == "not_available"

    body = conn |> get(~p"/o/ngc-224") |> html_response(200)
    assert body =~ "Not supplied by the source catalog"
    refute body =~ "543.59396283"
    refute body =~ "543.59"
  end

  test "sitemaps expose eligible catalogs as XML", %{conn: conn} do
    index = conn |> get(~p"/sitemap.xml") |> response(200)
    assert index =~ "<sitemapindex"
    assert index =~ "/sitemaps/messier_deep_sky.xml"
    part = conn |> recycle() |> get("/sitemaps/messier_deep_sky.xml") |> response(200)
    assert part =~ "<urlset"
    assert part =~ "/o/ngc-224"
  end
end
