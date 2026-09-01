defmodule StarsmapApiWeb.AgentApiControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  alias StarsmapApi.Catalog.{PublicCache, SnapshotStore}

  setup do
    PublicCache.clear()

    SnapshotStore.upsert_source_objects([
      %{
        key: "ngc-224",
        name: "NGC 224 Andromeda Galaxy",
        aliases: ["M31", "Andromeda Galaxy"],
        object_type: "galaxy",
        catalog_group: "messier_deep_sky",
        source_type: "deep_sky_catalog",
        position_model: "heasarc_neargalcat_j2000_distance_coordinates",
        search_text: "ngc 224 andromeda galaxy m31",
        external_ids: %{"messier" => "M31"},
        facts: %{"constellation" => "Andromeda"},
        source: %{},
        ra_deg: 10.684,
        dec_deg: 41.269,
        distance_pc: 778_000.0,
        distance_ly: 2_537_000.0,
        apparent_magnitude: 3.44,
        x_au: 11.25,
        y_au: -22.5,
        z_au: 1.0
      }
    ])

    PublicCache.clear()
    :ok
  end

  test "search is bounded and returns named-object links", %{conn: conn} do
    payload =
      conn
      |> get(~p"/api/agent/v1/objects/search?q=Andromeda&limit=1")
      |> json_response(200)

    assert payload["query"] == "Andromeda"
    assert payload["limit"] == 1
    assert payload["count"] == 1
    assert [result] = payload["results"]
    assert result["key"] == "ngc-224"
    assert result["catalog_id"] == "messier_deep_sky"
    assert result["links"]["object"] =~ "/o/ngc-224"
    assert result["links"]["api"] =~ "/api/agent/v1/objects/ngc-224"
  end

  test "search rejects missing, short, long, and unbounded requests", %{conn: conn} do
    for {path, code, parameter} <- [
          {~p"/api/agent/v1/objects/search", "missing_query", "q"},
          {~p"/api/agent/v1/objects/search?q=ab", "invalid_query", "q"},
          {"/api/agent/v1/objects/search?q=#{String.duplicate("a", 81)}", "invalid_query", "q"},
          {~p"/api/agent/v1/objects/search?q=Andromeda&limit=11", "invalid_limit", "limit"}
        ] do
      error = conn |> recycle() |> get(path) |> json_response(400) |> get_in(["error"])
      assert error["code"] == code
      assert error["parameter"] == parameter
    end
  end

  test "object details contain only grounded fields, provenance, and stable links", %{conn: conn} do
    payload = conn |> get(~p"/api/agent/v1/objects/ngc-224") |> json_response(200)

    assert payload["object"]["name"] == "NGC 224 Andromeda Galaxy"
    assert payload["object"]["astrometry"]["ra_deg"] == 10.684
    assert payload["provenance"]["source_type"] == "deep_sky_catalog"
    assert payload["provenance"]["catalog"]["source_url"] =~ "simbad.cds.unistra.fr"
    assert payload["links"]["human"] =~ "/o/ngc-224"

    error = conn |> recycle() |> get(~p"/api/agent/v1/objects/not-real") |> json_response(404)
    assert error["error"]["code"] == "object_not_found"
  end

  test "catalog list is finite and separates catalog IDs from view-layer IDs", %{conn: conn} do
    payload = conn |> get(~p"/api/agent/v1/catalogs") |> json_response(200)

    assert length(payload["catalogs"]) <= 30
    assert length(payload["display_layers"]) <= 20

    assert Enum.find(payload["catalogs"], &(&1["id"] == "gaia_local_stars"))["source_url"] =~
             "esa.int"

    assert Enum.find(payload["catalogs"], &(&1["id"] == "erosita_dr2_xray"))["caveat"] =~
             "eROSITA"

    assert Enum.map(payload["display_layers"], & &1["id"]) == [
             "grid",
             "labels",
             "milkyWay",
             "milkyWayArms",
             "milkyWayDust",
             "milkyWayGuides",
             "orbits",
             "references"
           ]
  end

  test "view-link builder emits a versioned link with the exact requested layer state", %{
    conn: conn
  } do
    payload =
      conn
      |> get(~p"/api/agent/v1/view-link", %{
        "center_x_au" => "1.5",
        "center_y_au" => "-2.25",
        "zoom" => "30",
        "time" => "2026-08-31T00:00:00Z",
        "layers" => "grid,labels"
      })
      |> json_response(200)

    query = payload["url"] |> URI.parse() |> Map.fetch!(:query) |> URI.decode_query()
    assert query["v"] == "1"
    assert query["c"] == "1.5,-2.25"
    assert query["z"] == "30"
    assert query["t"] == "2026-08-31T00:00:00Z"

    assert query["L"] ==
             "grid.1~labels.1~milkyWay.0~milkyWayArms.0~milkyWayDust.0~milkyWayGuides.0~orbits.0~references.0"

    assert payload["parameters"]["visible_layers"] == ["grid", "labels"]
    assert payload["limitation"] =~ "not right ascension and declination"
  end

  test "view-link builder uses a public object's validated position", %{conn: conn} do
    payload =
      conn
      |> get(~p"/api/agent/v1/view-link?object_key=ngc-224&layers=grid")
      |> json_response(200)

    query = payload["url"] |> URI.parse() |> Map.fetch!(:query) |> URI.decode_query()
    assert query["c"] == "11.25,-22.5"
    assert query["o"] == "ngc-224"
    assert payload["object_url"] =~ "/o/ngc-224"
  end

  test "view-link builder rejects invented layers and incomplete coordinates", %{conn: conn} do
    layer_error =
      conn
      |> get(~p"/api/agent/v1/view-link?center_x_au=0&center_y_au=0&layers=invented")
      |> json_response(400)

    assert layer_error["error"]["code"] == "invalid_layers"

    coordinate_error =
      conn
      |> recycle()
      |> get(~p"/api/agent/v1/view-link?center_x_au=0")
      |> json_response(400)

    assert coordinate_error["error"]["code"] == "invalid_number"
    assert coordinate_error["error"]["parameter"] == "center_y_au"
  end
end
