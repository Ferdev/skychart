defmodule StarsmapApi.AgentSkyFixtures do
  @moduledoc "Deterministic scientific-service answers and catalog rows for agent-surface tests."

  alias StarsmapApi.Catalog.{PublicCache, SnapshotStore}

  defmodule Ephemeris do
    @behaviour StarsmapApi.SkyShare.Ephemeris

    @impl true
    def snapshot(epoch, keys) do
      core = [
        body("sun", "Sun", "star", nil, {0.0, 0.0, 0.0}, 149_597_870.7),
        body("earth", "Earth", "planet", "sun", {1.0, 0.0, 0.0}, 0.0),
        body("mars", "Mars", "planet", "sun", {1.0, 2.0, 0.0}, 299_195_741.4)
      ]

      voyager =
        if "spacecraft-31" in keys,
          do: [
            body("spacecraft-31", "Voyager 1", "spacecraft", "sun", {-31.0, -137.0, 99.0}, nil)
          ],
          else: []

      {:ok,
       %{
         "timestamp_utc" => DateTime.to_iso8601(epoch),
         "data_source" => "Fixture ephemeris",
         "bodies" => core ++ voyager
       }}
    end

    defp body(key, name, type, parent, {x, y, z}, distance_from_earth_km) do
      %{
        "key" => key,
        "name" => name,
        "object_type" => type,
        "parent_key" => parent,
        "catalog_group" => if(type == "spacecraft", do: "spacecraft", else: "core"),
        "position" => %{"x_au" => x, "y_au" => y, "z_au" => z},
        "distance_from_earth_km" => distance_from_earth_km
      }
    end
  end

  defmodule UnavailableEphemeris do
    @behaviour StarsmapApi.SkyShare.Ephemeris
    @impl true
    def snapshot(_epoch, _keys), do: {:error, :econnrefused}
  end

  defmodule Observation do
    @behaviour StarsmapApi.AgentSky.Observation

    @impl true
    def observe("jupiter", latitude, longitude) do
      {:ok,
       %{
         "key" => "jupiter",
         "name" => "Jupiter",
         "observed_at_utc" => "2026-10-10T23:00:00Z",
         "latitude_deg" => latitude,
         "longitude_deg" => longitude,
         "altitude_deg" => -24.8,
         "azimuth_deg" => 39.8,
         "rise_utc" => "2026-10-11T01:40:00Z",
         "transit_utc" => "2026-10-11T08:30:00Z",
         "set_utc" => "2026-10-11T15:25:00Z",
         "summary" => "Above the horizon from 01:40 UTC; best around 08:30 UTC.",
         "accuracy_note" =>
           "Geometric five-minute sampling; refraction and local obstructions are not modeled."
       }}
    end

    def observe("offline", _latitude, _longitude), do: {:error, :econnrefused}
    def observe(_key, _latitude, _longitude), do: {:error, :not_modeled}
  end

  @doc "Replaces the scientific-service providers for one test."
  def stub_scientific_service(ephemeris \\ Ephemeris) do
    put_env(:sky_share_ephemeris_provider, ephemeris)
    put_env(:agent_observation_provider, Observation)
  end

  def seed_catalog do
    PublicCache.clear()

    SnapshotStore.upsert_source_objects([
      object("ngc-224", "NGC 224 Andromeda Galaxy", ["M31", "Andromeda Galaxy"], "galaxy", %{
        catalog_group: "messier_deep_sky",
        source_type: "deep_sky_catalog",
        ra_deg: 10.684,
        dec_deg: 41.269,
        distance_ly: 2_537_000.0,
        apparent_magnitude: 3.44,
        x_au: 11.25,
        y_au: -22.5,
        z_au: 1.0
      }),
      object("fixture-star", "Fixture Star", [], "star", %{
        catalog_group: "bright_stars",
        source_type: "bright_star_catalog",
        ra_deg: 101.287,
        dec_deg: -16.716,
        distance_ly: 8.6,
        apparent_magnitude: -1.46,
        x_au: 11.25,
        y_au: -22.5,
        z_au: 5.0
      })
    ])

    PublicCache.clear()
    :ok
  end

  defp object(key, name, aliases, type, fields) do
    Map.merge(
      %{
        key: key,
        name: name,
        aliases: aliases,
        object_type: type,
        position_model: "catalog_j2000_distance_coordinates",
        search_text: String.downcase(Enum.join([key, name | aliases], " ")),
        external_ids: %{},
        facts: %{},
        source: %{}
      },
      fields
    )
  end

  defp put_env(key, value) do
    previous = Application.get_env(:starsmap_api, key)
    Application.put_env(:starsmap_api, key, value)

    ExUnit.Callbacks.on_exit(fn ->
      if previous,
        do: Application.put_env(:starsmap_api, key, previous),
        else: Application.delete_env(:starsmap_api, key)
    end)
  end
end
