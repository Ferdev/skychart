defmodule StarsmapApi.SkyShare.TestEphemerisProvider do
  @behaviour StarsmapApi.SkyShare.Ephemeris

  @impl true
  def snapshot(epoch, keys) do
    position = fn x, y, z ->
      %{
        "x_au" => x,
        "y_au" => y,
        "z_au" => z,
        "x_km" => x * 149_597_870.7,
        "y_km" => y * 149_597_870.7,
        "z_km" => z * 149_597_870.7
      }
    end

    core = [
      %{
        "key" => "sun",
        "name" => "Sun",
        "object_type" => "star",
        "catalog_group" => "core",
        "color" => "#ffd166",
        "position" => position.(0.0, 0.0, 0.0),
        "distance_from_earth_km" => 149_597_870.7
      },
      %{
        "key" => "earth",
        "name" => "Earth",
        "object_type" => "planet",
        "catalog_group" => "core",
        "color" => "#62a8ff",
        "position" => position.(1.0, 0.0, 0.0),
        "distance_from_earth_km" => 0.0
      },
      %{
        "key" => "mars",
        "name" => "Mars",
        "object_type" => "planet",
        "catalog_group" => "core",
        "color" => "#df6b43",
        "position" => position.(1.5, 0.2, 0.03),
        "distance_from_earth_km" => 80_000_000.0
      }
    ]

    extras =
      if "fixture-asteroid" in keys do
        [
          %{
            "key" => "fixture-asteroid",
            "name" => "Fixture asteroid",
            "object_type" => "asteroid",
            "catalog_group" => "jpl_small_bodies",
            "color" => "#c9a27c",
            "position" => position.(2.0, 0.4, 0.1),
            "distance_from_earth_km" => 160_000_000.0
          }
        ]
      else
        []
      end

    {:ok, %{"timestamp_utc" => DateTime.to_iso8601(epoch), "bodies" => core ++ extras}}
  end
end

defmodule StarsmapApi.SkyShare.FailingEphemerisProvider do
  @behaviour StarsmapApi.SkyShare.Ephemeris
  @impl true
  def snapshot(_epoch, _keys), do: {:error, :offline}
end

defmodule StarsmapApiWeb.SkyShareControllerTest do
  use StarsmapApiWeb.ConnCase, async: false

  alias StarsmapApi.Catalog.{PublicCache, PublicObjects, SnapshotStore}
  alias StarsmapApi.SkyShare.CardCache

  @query "v=1&t=2042-04-05T06%3A07%3A08.000Z&sc=182.5%2C-12%2C64&sl=0&sf=asteroid%2Ccomet&r=fixture-v9&lang=fr"

  setup do
    previous_provider = Application.get_env(:starsmap_api, :sky_share_ephemeris_provider)

    Application.put_env(
      :starsmap_api,
      :sky_share_ephemeris_provider,
      StarsmapApi.SkyShare.TestEphemerisProvider
    )

    PublicCache.clear()
    CardCache.clear()

    SnapshotStore.upsert_source_objects([
      %{
        key: "proxima-centauri",
        name: "Próxima <script>alert(1)</script> Centauri",
        aliases: ["Alpha Centauri C"],
        object_type: "star",
        catalog_group: "nearby_stars",
        source_type: "bright_star_catalog",
        position_model: "hipparcos_catalog_coordinates",
        search_text: "proxima centauri",
        external_ids: %{},
        facts: %{},
        source: %{},
        distance_ly: 4.2465,
        apparent_magnitude: 11.13,
        x_au: -84_000.0,
        y_au: -240_000.0,
        z_au: -28_000.0
      },
      %{
        key: "missing-position",
        name: "Missing position",
        aliases: [],
        object_type: "star",
        catalog_group: "nearby_stars",
        source_type: "bright_star_catalog",
        position_model: "hipparcos_catalog_coordinates",
        search_text: "missing position",
        external_ids: %{},
        facts: %{},
        source: %{},
        x_au: nil,
        y_au: nil,
        z_au: nil
      },
      %{
        key: "private-bulk",
        name: "Private bulk star",
        aliases: [],
        object_type: "star",
        catalog_group: "gaia_500pc_stars",
        source_type: "gaia_dr3",
        position_model: "catalog",
        search_text: "private bulk",
        external_ids: %{},
        facts: %{},
        source: %{},
        x_au: 1.0,
        y_au: 2.0,
        z_au: 3.0
      }
    ])

    on_exit(fn ->
      if previous_provider,
        do: Application.put_env(:starsmap_api, :sky_share_ephemeris_provider, previous_provider),
        else: Application.delete_env(:starsmap_api, :sky_share_ephemeris_provider)

      PublicCache.clear()
      CardCache.clear()
    end)

    :ok
  end

  test "renders escaped observer-specific metadata and an exact large-card contract", %{
    conn: conn
  } do
    html = conn |> get("/sky/proxima-centauri?#{@query}") |> html_response(200)

    assert html =~ "Le ciel depuis Próxima"
    assert html =~ "— Cosmic Atlas"

    assert html =~
             ~r/<link rel="canonical" href="http:\/\/localhost(?::\d+)?\/sky\/proxima-centauri">/

    assert html =~
             ~r/<meta property="og:url" content="http:\/\/localhost(?::\d+)?\/sky\/proxima-centauri\?v=1&amp;t=/

    assert html =~
             ~r/<meta property="og:image" content="http:\/\/localhost(?::\d+)?\/sky\/proxima-centauri\/card\.png\?v=1&amp;t=/

    assert html =~ ~s(<meta property="og:image:type" content="image/png">)
    assert html =~ ~s(<meta property="og:image:width" content="1200">)
    assert html =~ ~s(<meta property="og:image:height" content="630">)
    assert html =~ ~s(<meta name="twitter:card" content="summary_large_image">)
    assert html =~ ~s(<meta name="twitter:image:alt")
    assert html =~ ~s(<meta name="robots" content="noindex,follow">)
    assert length(Regex.scan(~r/<link rel="canonical"/, html)) == 1
    refute html =~ "<script>alert(1)</script>"
    assert html =~ "&lt;script&gt;alert(1)&lt;/script&gt;"
    refute html =~ "observer_x_au"
  end

  test "resolves catalog observers without loading object-page enrichment" do
    assert {:ok, observer} = PublicObjects.public_observer("proxima-centauri")

    assert observer.name == "Próxima <script>alert(1)</script> Centauri"
    refute Map.has_key?(observer, :related)
    refute Map.has_key?(observer, :semantics)

    assert {:error, :not_found} = PublicObjects.public_observer("private-bulk")
  end

  test "serves deterministic cached PNG cards with ETag validation", %{conn: conn} do
    path = "/sky/proxima-centauri/card.png?#{@query}"
    first = get(conn, path)
    png = response(first, 200)

    assert get_resp_header(first, "content-type") == ["image/png; charset=utf-8"] or
             get_resp_header(first, "content-type") == ["image/png"]

    assert <<137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, "IHDR", 1200::unsigned-big-32,
             630::unsigned-big-32, _rest::binary>> = png

    assert [etag] = get_resp_header(first, "etag")

    assert get_resp_header(first, "cache-control") == [
             "public, max-age=86400, stale-while-revalidate=604800"
           ]

    assert get_resp_header(first, "x-sky-card-cache") == ["miss"]

    second = first |> recycle() |> get(path)
    assert response(second, 200) == png
    assert get_resp_header(second, "etag") == [etag]
    assert get_resp_header(second, "x-sky-card-cache") == ["hit"]

    validated = second |> recycle() |> put_req_header("if-none-match", etag) |> get(path)
    assert response(validated, 304) == ""
    assert get_resp_header(validated, "etag") == [etag]
  end

  test "normalizes cache state, ignores public coordinates, and varies real layer settings", %{
    conn: conn
  } do
    base = get(conn, "/sky/proxima-centauri/card.png?#{@query}")
    [base_etag] = get_resp_header(base, "etag")

    spoofed =
      base
      |> recycle()
      |> get("/sky/proxima-centauri/card.png?#{@query}&observer_x_au=1e300&observer_y_au=-1e300")

    assert get_resp_header(spoofed, "etag") == [base_etag]

    equivalent =
      base
      |> recycle()
      |> get(
        "/sky/proxima-centauri/card.png?v=1&t=2042-04-05T06%3A07%3A08Z&sc=182.54%2C-12.04%2C64.04&sl=0&sf=comet%2Casteroid&r=fixture-v9&lang=fr"
      )

    assert get_resp_header(equivalent, "etag") == [base_etag]

    different_layers =
      base
      |> recycle()
      |> get(
        "/sky/proxima-centauri/card.png?v=1&t=2042-04-05T06%3A07%3A08.000Z&sc=182.5%2C-12%2C64&lang=fr"
      )

    refute get_resp_header(different_layers, "etag") == [base_etag]
    refute response(different_layers, 200) == response(base, 200)
  end

  test "rejects malformed, unavailable, non-public, and oversized Sky requests", %{conn: conn} do
    assert conn |> get("/sky/proxima-centauri?v=1&t=now&sc=0,0,72") |> html_response(400) =~
             "Invalid Sky link"

    assert conn
           |> recycle()
           |> get("/sky/proxima-centauri?v=1&t=2042-04-05T00:00:00Z&sc=0,95,72")
           |> html_response(400) =~ "Invalid Sky link"

    assert conn
           |> recycle()
           |> get("/sky/proxima-centauri?v=1&v=1&t=2042-04-05T00:00:00Z&sc=0,0,72")
           |> html_response(400) =~ "Invalid Sky link"

    assert conn |> recycle() |> get("/sky/not-real?#{@query}") |> html_response(404) =~
             "Sky observer not found"

    assert conn |> recycle() |> get("/sky/private-bulk?#{@query}") |> html_response(404) =~
             "Sky observer not found"

    assert conn |> recycle() |> get("/sky/missing-position?#{@query}") |> html_response(422) =~
             "Sky position unavailable"

    assert conn
           |> recycle()
           |> get("/sky/proxima-centauri?#{@query}&padding=#{String.duplicate("x", 1_600)}")
           |> html_response(414) =~ "Sky link too long"
  end

  test "dynamic observers fail recoverably when ephemeris resolution is unavailable", %{
    conn: conn
  } do
    Application.put_env(
      :starsmap_api,
      :sky_share_ephemeris_provider,
      StarsmapApi.SkyShare.FailingEphemerisProvider
    )

    html = conn |> get("/sky/earth?#{@query}") |> html_response(503)
    assert html =~ "Sky ephemeris unavailable"
    assert html =~ "Return to the atlas"
  end

  test "resolves a dynamic observer at the requested UTC epoch", %{conn: conn} do
    html = conn |> get("/sky/earth?#{@query}") |> html_response(200)
    assert html =~ "Le ciel depuis Earth — Cosmic Atlas"
    assert html =~ "/sky/earth/card.png"
  end
end
