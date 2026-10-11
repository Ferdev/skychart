defmodule StarsmapApi.AgentSkyTest do
  use StarsmapApi.DataCase, async: false

  alias StarsmapApi.AgentSky
  alias StarsmapApi.AgentSkyFixtures
  alias StarsmapApi.SkyEvents

  setup do
    AgentSkyFixtures.stub_scientific_service()
    AgentSkyFixtures.seed_catalog()
  end

  describe "positions/1" do
    test "returns the default bodies that the ephemeris has, with distances from Earth" do
      assert {:ok, payload} = AgentSky.positions(%{"time" => "2026-10-10T12:00:00+02:00"})

      assert payload.time_utc == "2026-10-10T10:00:00Z"
      assert payload.source == "Fixture ephemeris"
      assert Enum.map(payload.bodies, & &1.key) == ["sun", "earth", "mars"]

      mars = Enum.find(payload.bodies, &(&1.key == "mars"))
      assert mars.position_au == %{x: 1.0, y: 2.0, z: 0.0}
      assert_in_delta mars.heliocentric_distance_au, :math.sqrt(5.0), 1.0e-9
      assert_in_delta mars.distance_from_earth_au, 2.0, 1.0e-6
      assert_in_delta mars.light_time_from_earth_minutes, 16.6337, 1.0e-3
      assert mars.object_url =~ "/o/mars"

      # The fixture has no position for these bodies; the result says so and invents nothing.
      assert %{key: "jupiter", reason: "position_not_available"} =
               Enum.find(payload.unavailable, &(&1.key == "jupiter"))
    end

    test "hydrates a requested spacecraft and derives its distance from Earth" do
      assert {:ok, payload} =
               AgentSky.positions(%{"bodies" => ["Earth", "spacecraft-31"], "time" => "now"})

      assert [%{key: "earth"}, %{key: "spacecraft-31", name: "Voyager 1"} = voyager] =
               payload.bodies

      assert_in_delta voyager.distance_from_earth_au,
                      :math.sqrt(32.0 * 32.0 + 137.0 * 137.0 + 99.0 * 99.0),
                      1.0e-6
    end

    test "rejects unknown bodies, too many spacecraft, and times outside the ephemeris" do
      assert {:error, %{code: "unknown_body", parameter: "bodies"}} =
               AgentSky.positions(%{"bodies" => ["vulcan"]})

      assert {:error, %{code: "unknown_body"}} =
               AgentSky.positions(%{"bodies" => ["spacecraft-not-real"]})

      assert {:error, %{code: "invalid_bodies"}} = AgentSky.positions(%{"bodies" => 5})

      for time <- ["yesterday", "2026-10-10T00:00:00", "1700-01-01T00:00:00Z", 5] do
        assert {:error, %{code: "invalid_time", parameter: "time"}} =
                 AgentSky.positions(%{"time" => time})
      end
    end

    test "reports an unavailable ephemeris as a retryable error" do
      AgentSkyFixtures.stub_scientific_service(AgentSkyFixtures.UnavailableEphemeris)
      assert {:error, %{code: "ephemeris_unavailable"}} = AgentSky.positions(%{})
    end
  end

  describe "separation/1" do
    test "measures between ephemeris bodies at the given time" do
      assert {:ok, payload} =
               AgentSky.separation(%{"from_key" => "earth", "to_key" => "Mars"})

      assert payload.from.key == "earth"
      assert payload.to.name == "Mars"
      assert_in_delta payload.separation.au, 2.0, 1.0e-12
      assert_in_delta payload.separation.km, 2.0 * 149_597_870.7, 1.0e-3
      assert_in_delta payload.separation.light_travel_time_seconds, 998.01, 0.01
      assert payload.limitation =~ "static catalog position"
    end

    test "measures between catalog objects and across catalog and ephemeris objects" do
      assert {:ok, catalog} =
               AgentSky.separation(%{"from_key" => "ngc-224", "to_key" => "fixture-star"})

      assert_in_delta catalog.separation.au, 4.0, 1.0e-12
      assert_in_delta catalog.separation.light_years, 4.0 / 63_241.077, 1.0e-9

      assert {:ok, mixed} = AgentSky.separation(%{"from_key" => "sun", "to_key" => "ngc-224"})

      assert_in_delta mixed.separation.au,
                      :math.sqrt(11.25 * 11.25 + 22.5 * 22.5 + 1.0),
                      1.0e-9
    end

    test "names the parameter of a missing or unknown object" do
      assert {:error, %{code: "missing_object_key", parameter: "to_key"}} =
               AgentSky.separation(%{"from_key" => "earth"})

      assert {:error, %{code: "object_not_found", parameter: "to_key"}} =
               AgentSky.separation(%{"from_key" => "earth", "to_key" => "not-real"})

      assert {:error, %{code: "invalid_object_key", parameter: "from_key"}} =
               AgentSky.separation(%{"from_key" => "../etc", "to_key" => "earth"})
    end
  end

  describe "sky_link/1" do
    test "aims the view at another object and returns the canonical permalink" do
      assert {:ok, payload} =
               AgentSky.sky_link(%{
                 "observer_key" => "earth",
                 "look_at_key" => "mars",
                 "time" => "2026-10-10T00:00:00Z"
               })

      # Mars is at (1, 2, 0) and Earth at (1, 0, 0): the direction is ecliptic longitude 90.
      assert payload.parameters.yaw_deg == 90.0
      assert payload.parameters.pitch_deg == 0.0
      assert payload.parameters.fov_deg == 72.0
      assert payload.observer.key == "earth"
      assert payload.looking_at.name == "Mars"

      uri = URI.parse(payload.url)
      assert uri.path == "/sky/earth"
      query = URI.decode_query(uri.query)
      assert query["v"] == "1"
      assert query["t"] == "2026-10-10T00:00:00.000Z"
      assert query["sc"] == "90,0,72"
      assert payload.preview_image_url =~ "/sky/earth/card.png?"
    end

    test "accepts an explicit camera, filters, and a locale" do
      assert {:ok, payload} =
               AgentSky.sky_link(%{
                 "observer_key" => "ngc-224",
                 "yaw_deg" => 370,
                 "pitch_deg" => -12.34,
                 "fov_deg" => 40,
                 "show_constellations" => false,
                 "hidden_object_types" => ["galaxy", "quasar"],
                 "locale" => "es"
               })

      assert payload.parameters.yaw_deg == 10.0
      assert payload.parameters.pitch_deg == -12.3
      assert payload.parameters.show_constellations == false
      assert payload.parameters.hidden_object_types == ["galaxy", "quasar"]
      assert payload.parameters.locale == "es"
      assert payload.looking_at == nil
      assert URI.decode_query(URI.parse(payload.url).query)["sf"] == "galaxy,quasar"
    end

    test "rejects conflicting, out-of-range, and unknown view parameters" do
      assert {:error, %{code: "conflicting_camera"}} =
               AgentSky.sky_link(%{
                 "observer_key" => "earth",
                 "look_at_key" => "mars",
                 "yaw_deg" => 10
               })

      assert {:error, %{code: "invalid_look_at"}} =
               AgentSky.sky_link(%{"observer_key" => "earth", "look_at_key" => "earth"})

      assert {:error, %{code: "invalid_camera"}} =
               AgentSky.sky_link(%{"observer_key" => "earth", "fov_deg" => 5})

      assert {:error, %{code: "invalid_object_types", parameter: "hidden_object_types"}} =
               AgentSky.sky_link(%{"observer_key" => "earth", "hidden_object_types" => ["ufo"]})

      assert {:error, %{code: "object_not_found", parameter: "observer_key"}} =
               AgentSky.sky_link(%{"observer_key" => "not-real"})
    end
  end

  describe "visibility/1" do
    test "returns the observation with the limits of the model" do
      assert {:ok, payload} =
               AgentSky.visibility(%{
                 "object_key" => "Jupiter",
                 "latitude_deg" => 40.4,
                 "longitude_deg" => "-3.7"
               })

      assert payload.object.name == "Jupiter"
      assert payload.latitude_deg == 40.4
      assert payload.longitude_deg == -3.7
      assert payload.above_horizon == false
      assert payload.rise_utc == "2026-10-11T01:40:00Z"
      assert payload.limitation =~ "refraction"
      assert payload.limitation =~ "not an observing plan"
    end

    test "separates an object that is not modeled from an unavailable service" do
      place = %{"latitude_deg" => 0, "longitude_deg" => 0}

      assert {:error, %{code: "visibility_not_available", parameter: "object_key"}} =
               AgentSky.visibility(Map.put(place, "object_key", "ngc-224"))

      assert {:error, %{code: "visibility_unavailable"}} =
               AgentSky.visibility(Map.put(place, "object_key", "offline"))

      assert {:error, %{code: "invalid_number", parameter: "latitude_deg"}} =
               AgentSky.visibility(%{
                 "object_key" => "jupiter",
                 "latitude_deg" => 91,
                 "longitude_deg" => 0
               })

      assert {:error, %{code: "invalid_number", parameter: "longitude_deg"}} =
               AgentSky.visibility(%{"object_key" => "jupiter", "latitude_deg" => 0})
    end
  end

  describe "events/1" do
    test "lists a bounded number of stored events with absolute object links" do
      now = DateTime.utc_now()

      {:ok, 3} =
        SkyEvents.upsert_all(
          for index <- 1..3 do
            %{
              source: "jpl_cneos",
              source_id: "fixture-#{index}",
              kind: "close_approach",
              title: "Fixture asteroid #{index}",
              summary: "Passes Earth at a safe distance.",
              starts_at: DateTime.add(now, index * 3_600, :second),
              catalog_key: if(index == 1, do: "ngc-224"),
              source_url: "https://cneos.jpl.nasa.gov/ca/"
            }
          end
        )

      assert {:ok, payload} = AgentSky.events(%{"limit" => 2})
      assert payload.count == 2
      assert payload.has_more == true
      assert payload.stale == false

      assert [%{id: "jpl_cneos:fixture-1", kind: "close_approach"} = first, second] =
               payload.events

      assert first.object_url == StarsmapApiWeb.Endpoint.url() <> "/o/ngc-224"
      assert second.object_url == nil
      assert second.source_url == "https://cneos.jpl.nasa.gov/ca/"

      assert {:error, %{code: "invalid_limit"}} = AgentSky.events(%{"limit" => 51})
      assert {:error, %{code: "invalid_limit"}} = AgentSky.events(%{"limit" => "many"})
    end

    test "marks an empty event store as stale" do
      assert {:ok, %{count: 0, events: [], stale: true, has_more: false}} = AgentSky.events(%{})
    end
  end

  test "tours/0 lists each guided tour with a link for each step" do
    %{tours: tours, index_url: index_url} = AgentSky.tours()

    assert index_url == StarsmapApiWeb.Endpoint.url() <> "/tours"
    assert %{} = tour = Enum.find(tours, &(&1.slug == "near-the-sun"))
    assert tour.title == "What is actually near the Sun"
    assert tour.url =~ "/tours/near-the-sun"
    assert [%{step: 0, title: "The Sun at the center"} = step | _] = tour.steps
    assert step.url =~ "/?tour=near-the-sun&step=0"
  end
end
