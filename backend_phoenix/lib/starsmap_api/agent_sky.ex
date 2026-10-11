defmodule StarsmapApi.AgentSky do
  @moduledoc """
  Bounded read-only agent operations that depend on an epoch or on the scientific
  service: positions, separations, visibility, Sky links, current events, and tours.
  """

  alias StarsmapApi.AgentInterface
  alias StarsmapApi.AgentSky.Observation
  alias StarsmapApi.SkyEvents
  alias StarsmapApi.SkyShare.Context
  alias StarsmapApi.SkyShare.Ephemeris
  alias StarsmapApi.SkyShare.State
  alias StarsmapApi.Spacecraft

  @au_km 149_597_870.7
  @au_per_light_year 63_241.07708426628
  @au_per_parsec 206_264.80624709636
  @light_speed_km_s 299_792.458
  @rad_to_deg 180.0 / :math.pi()

  # The DE440s kernel of the scientific service covers these years.
  @min_year 1850
  @max_year 2149

  @core_bodies ~w(sun mercury venus earth moon mars phobos deimos jupiter io europa ganymede callisto saturn titan rhea iapetus dione tethys enceladus mimas uranus neptune pluto)
  @default_bodies ~w(sun mercury venus earth moon mars jupiter saturn uranus neptune pluto)
  @max_bodies 24
  @max_spacecraft 4

  @default_event_limit 10
  @max_event_limit 50
  @stale_event_hours 36

  @max_pitch_deg 89.5
  @default_fov_deg 72.0

  def core_bodies, do: @core_bodies
  def sky_object_types, do: State.object_types()
  def sky_locales, do: State.locales()

  def positions(params) when is_map(params) do
    with {:ok, epoch} <- epoch(params["time"]),
         {:ok, keys} <- body_keys(params["bodies"]),
         {:ok, payload} <- snapshot(epoch, Enum.filter(keys, &spacecraft_key?/1)) do
      bodies = payload["bodies"]
      earth = bodies |> find_body("earth") |> body_position()
      rows = Enum.map(keys, &position_row(&1, find_body(bodies, &1), earth))

      {:ok,
       %{
         time_utc: DateTime.to_iso8601(epoch),
         coordinate_frame: "heliocentric ecliptic Cartesian coordinates in astronomical units",
         bodies: Enum.filter(rows, & &1[:position_au]),
         unavailable: Enum.reject(rows, & &1[:position_au]),
         source: payload["data_source"],
         limitation:
           "Geometric positions for atlas orientation. JPL Horizons and the SPICE kernels remain authoritative for navigation, observation planning, and published values.",
         documentation_url: absolute_url("/agents")
       }}
    end
  end

  def positions(_), do: invalid_parameters()

  def separation(params) when is_map(params) do
    with {:ok, from_key} <- object_key(params["from_key"], "from_key"),
         {:ok, to_key} <- object_key(params["to_key"], "to_key"),
         {:ok, epoch} <- epoch(params["time"]),
         {:ok, from} <- resolve(from_key, epoch, "from_key"),
         {:ok, to} <- resolve(to_key, epoch, "to_key") do
      au = norm(difference(to.position, from.position))
      km = au * @au_km

      {:ok,
       %{
         time_utc: DateTime.to_iso8601(epoch),
         from: located_object(from),
         to: located_object(to),
         separation: %{
           au: au,
           km: km,
           light_years: au / @au_per_light_year,
           parsecs: au / @au_per_parsec,
           light_travel_time_seconds: km / @light_speed_km_s
         },
         coordinate_frame: "heliocentric ecliptic Cartesian coordinates in astronomical units",
         limitation:
           "Straight-line separation in the atlas coordinate space. Solar System bodies and spacecraft use the ephemeris at the given time. Catalog objects use their static catalog position and the distance model on their object record, so distance uncertainty applies in full and extragalactic separations are not proper or comoving distances.",
         documentation_url: absolute_url("/agents")
       }}
    end
  end

  def separation(_), do: invalid_parameters()

  def sky_link(params) when is_map(params) do
    with {:ok, observer_key} <- object_key(params["observer_key"], "observer_key"),
         {:ok, epoch} <- epoch(params["time"]),
         {:ok, observer} <- resolve(observer_key, epoch, "observer_key"),
         {:ok, target} <- optional_target(params["look_at_key"], epoch),
         {:ok, {yaw, pitch}} <- direction(params, observer, target),
         {:ok, fov} <- optional_float(params["fov_deg"], "fov_deg", @default_fov_deg),
         {:ok, constellations} <- optional_boolean(params["show_constellations"]),
         {:ok, hidden} <- hidden_types(params["hidden_object_types"]),
         {:ok, state} <-
           sky_state(observer.key, epoch, {yaw, pitch, fov}, constellations, hidden, params) do
      {:ok,
       %{
         url: absolute_url(State.permalink_path(state)),
         preview_image_url: absolute_url(State.card_path(state)),
         observer: named_object(observer),
         looking_at: target && named_object(target),
         parameters: %{
           time: DateTime.to_iso8601(state.epoch_utc),
           yaw_deg: state.yaw_deg,
           pitch_deg: state.pitch_deg,
           fov_deg: state.fov_deg,
           show_constellations: state.constellations,
           hidden_object_types: state.hidden_object_types,
           locale: state.locale
         },
         coordinate_frame:
           "yaw_deg and pitch_deg are the heliocentric ecliptic longitude and latitude of the view direction",
         limitation:
           "A geometric view of catalog directions from the observer position. It does not model a horizon, an atmosphere, light-travel time, or instrument limits."
       }}
    end
  end

  def sky_link(_), do: invalid_parameters()

  def visibility(params) when is_map(params) do
    with {:ok, key} <- object_key(params["object_key"], "object_key"),
         {:ok, latitude} <- required_float(params["latitude_deg"], "latitude_deg", -90.0, 90.0),
         {:ok, longitude} <-
           required_float(params["longitude_deg"], "longitude_deg", -180.0, 180.0) do
      case Observation.observe(key, latitude, longitude) do
        {:ok, payload} ->
          {:ok,
           %{
             object: %{
               key: payload["key"],
               name: payload["name"],
               object_url: object_url(payload["key"] || key)
             },
             observed_at_utc: payload["observed_at_utc"],
             latitude_deg: payload["latitude_deg"],
             longitude_deg: payload["longitude_deg"],
             altitude_deg: payload["altitude_deg"],
             azimuth_deg: payload["azimuth_deg"],
             above_horizon: above_horizon?(payload["altitude_deg"]),
             rise_utc: payload["rise_utc"],
             transit_utc: payload["transit_utc"],
             set_utc: payload["set_utc"],
             summary: payload["summary"],
             limitation:
               "#{payload["accuracy_note"]} Rise, transit, and set times cover the next 24 hours from the current time. Daylight, twilight, weather, and the Moon are not considered; this is not an observing plan."
           }}

        {:error, :not_modeled} ->
          AgentInterface.error(
            :visibility_not_available,
            "Visibility is modeled only for the Sun, the Moon, the planets and their major moons, Hipparcos bright stars (hip-...), exoplanet host systems, and Messier objects (m1 to m110). Spacecraft are not modeled.",
            "object_key"
          )

        {:error, _reason} ->
          AgentInterface.error(
            :visibility_unavailable,
            "The observation service is temporarily unavailable; retry later."
          )
      end
    end
  end

  def visibility(_), do: invalid_parameters()

  def events(params) when is_map(params) do
    with {:ok, limit} <- event_limit(params["limit"]) do
      refreshed_at = SkyEvents.last_refreshed_at()
      events = SkyEvents.list_upcoming()

      {:ok,
       %{
         refreshed_at: refreshed_at,
         stale: stale?(refreshed_at),
         count: min(length(events), limit),
         has_more: length(events) > limit,
         events: events |> Enum.take(limit) |> Enum.map(&event/1),
         feed_url: absolute_url("/feed.xml"),
         limitation:
           "A bounded list of recent and upcoming events from the stored JPL CNEOS and NASA Exoplanet Archive feeds. It is not a complete almanac; confirm times and parameters with the linked source."
       }}
    end
  end

  def events(_), do: invalid_parameters()

  def tours do
    tours =
      Application.app_dir(:starsmap_api, "priv/static/tours/*.json")
      |> Path.wildcard()
      |> Enum.sort()
      |> Enum.flat_map(&tour/1)

    %{tours: tours, index_url: absolute_url("/tours")}
  end

  defp tour(path) do
    with {:ok, body} <- File.read(path),
         {:ok, %{"slug" => slug, "title" => title, "steps" => steps} = tour}
         when is_binary(slug) and is_binary(title) and is_list(steps) <- Jason.decode(body),
         true <- Regex.match?(~r/^[a-z0-9][a-z0-9-]{0,79}$/, slug) do
      [
        %{
          slug: slug,
          title: title,
          description: tour["description"],
          url: absolute_url("/tours/" <> slug),
          start_url: absolute_url("/?tour=#{slug}&step=0"),
          steps:
            steps
            |> Enum.with_index()
            |> Enum.map(fn {step, index} ->
              %{
                step: index,
                title: step["title"],
                body: step["body"],
                url: absolute_url("/?tour=#{slug}&step=#{index}")
              }
            end)
        }
      ]
    else
      _ -> []
    end
  end

  defp position_row(key, body, earth) do
    case body_position(body) do
      nil ->
        %{key: key, name: body && body["name"], reason: unavailable_reason(body)}

      position ->
        distance_km = earth_distance_km(body, position, earth)

        %{
          key: key,
          name: body["name"],
          object_type: body["object_type"],
          parent_key: body["parent_key"],
          position_au: rounded_position(position),
          heliocentric_distance_au: round_au(norm(position)),
          distance_from_earth_au: distance_km && round_au(distance_km / @au_km),
          distance_from_earth_km: distance_km && Float.round(distance_km, 1),
          light_time_from_earth_minutes:
            distance_km && Float.round(distance_km / @light_speed_km_s / 60.0, 4),
          object_url: object_url(key)
        }
    end
  end

  defp unavailable_reason(%{"spacecraft" => %{"availability" => availability}})
       when is_binary(availability),
       do: availability

  defp unavailable_reason(_), do: "position_not_available"

  defp earth_distance_km(%{"distance_from_earth_km" => supplied}, _position, _earth)
       when is_number(supplied) and supplied >= 0,
       do: supplied * 1.0

  defp earth_distance_km(_body, position, %{} = earth),
    do: norm(difference(position, earth)) * @au_km

  defp earth_distance_km(_body, _position, _earth), do: nil

  defp body_position(%{"position" => %{"x_au" => x, "y_au" => y, "z_au" => z}})
       when is_number(x) and is_number(y) and is_number(z),
       do: %{x: x * 1.0, y: y * 1.0, z: z * 1.0}

  defp body_position(_), do: nil

  defp find_body(bodies, key), do: Enum.find(bodies, &(is_map(&1) and &1["key"] == key))

  defp body_keys(nil), do: {:ok, @default_bodies}

  defp body_keys(value) when is_binary(value),
    do: value |> String.split(",", trim: true) |> body_keys()

  defp body_keys(values) when is_list(values) do
    keys =
      values
      |> Enum.map(&if(is_binary(&1), do: &1 |> String.trim() |> String.downcase(), else: &1))
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    invalid = Enum.reject(keys, &(is_binary(&1) and (&1 in @core_bodies or spacecraft?(&1))))

    cond do
      keys == [] ->
        {:ok, @default_bodies}

      invalid != [] ->
        AgentInterface.error(
          :unknown_body,
          "bodies accepts #{Enum.join(@core_bodies, ", ")}, and spacecraft keys from search_sky_objects (spacecraft-...). Unknown: #{invalid |> Enum.take(5) |> Enum.map_join(", ", &inspect/1)}.",
          "bodies"
        )

      length(keys) > @max_bodies or Enum.count(keys, &spacecraft_key?/1) > @max_spacecraft ->
        AgentInterface.error(
          :too_many_bodies,
          "bodies accepts at most #{@max_bodies} keys, of which at most #{@max_spacecraft} are spacecraft.",
          "bodies"
        )

      true ->
        {:ok, keys}
    end
  end

  defp body_keys(_),
    do: AgentInterface.error(:invalid_bodies, "bodies must be a list of object keys.", "bodies")

  defp spacecraft_key?(key), do: String.starts_with?(key, "spacecraft-")
  defp spacecraft?(key), do: spacecraft_key?(key) and match?({:ok, _}, Spacecraft.get(key))

  defp snapshot(epoch, keys) do
    case Ephemeris.snapshot(epoch, keys) do
      {:ok, %{"bodies" => bodies} = payload} when is_list(bodies) -> {:ok, payload}
      _ -> ephemeris_unavailable()
    end
  end

  defp resolve(key, epoch, parameter) do
    case Context.resolve(key, epoch) do
      {:ok, object, _scene_bodies} ->
        {:ok, object}

      {:error, :observer_not_found} ->
        AgentInterface.error(
          :object_not_found,
          "No public SkyChart object matches #{parameter}. Use a key from search_sky_objects.",
          parameter
        )

      {:error, :invalid_observer_position} ->
        AgentInterface.error(
          :coordinates_not_available,
          "This object has no validated three-dimensional atlas position.",
          parameter
        )

      {:error, _reason} ->
        ephemeris_unavailable()
    end
  end

  defp ephemeris_unavailable,
    do:
      AgentInterface.error(
        :ephemeris_unavailable,
        "The ephemeris service is temporarily unavailable for this time; retry later."
      )

  defp optional_target(nil, _epoch), do: {:ok, nil}
  defp optional_target("", _epoch), do: {:ok, nil}

  defp optional_target(value, epoch) do
    with {:ok, key} <- object_key(value, "look_at_key"), do: resolve(key, epoch, "look_at_key")
  end

  defp direction(params, _observer, nil) do
    with {:ok, yaw} <- optional_float(params["yaw_deg"], "yaw_deg", 0.0),
         {:ok, pitch} <- optional_float(params["pitch_deg"], "pitch_deg", 0.0) do
      {:ok, {yaw, pitch}}
    end
  end

  defp direction(params, observer, target) do
    offset = difference(target.position, observer.position)
    length = norm(offset)

    cond do
      present?(params["yaw_deg"]) or present?(params["pitch_deg"]) ->
        AgentInterface.error(
          :conflicting_camera,
          "Provide look_at_key, or yaw_deg and pitch_deg, but not both.",
          "look_at_key"
        )

      length < 1.0e-12 ->
        AgentInterface.error(
          :invalid_look_at,
          "look_at_key must be a different object from observer_key.",
          "look_at_key"
        )

      true ->
        pitch = :math.asin(offset.z / length) * @rad_to_deg

        {:ok,
         {:math.atan2(offset.y, offset.x) * @rad_to_deg,
          pitch |> min(@max_pitch_deg) |> max(-@max_pitch_deg)}}
    end
  end

  defp sky_state(observer_key, epoch, {yaw, pitch, fov}, constellations, hidden, params) do
    state_params =
      %{
        "v" => Integer.to_string(State.version()),
        "t" => DateTime.to_iso8601(epoch),
        "sc" => Enum.map_join([yaw, pitch, fov], ",", &Float.to_string/1),
        "sl" => if(constellations, do: "1", else: "0"),
        "sf" => Enum.join(hidden, ","),
        "lang" => params["locale"]
      }

    case State.parse(observer_key, state_params) do
      {:ok, state} ->
        {:ok, state}

      {:error, :invalid_camera} ->
        AgentInterface.error(
          :invalid_camera,
          "pitch_deg must be from -89.5 through 89.5 and fov_deg from 20 through 110.",
          "pitch_deg"
        )

      {:error, :invalid_filters} ->
        AgentInterface.error(
          :invalid_object_types,
          "hidden_object_types accepts: #{Enum.join(State.object_types(), ", ")}.",
          "hidden_object_types"
        )

      {:error, _reason} ->
        AgentInterface.error(:invalid_parameters, "The Sky link parameters are invalid.")
    end
  end

  defp hidden_types(nil), do: {:ok, []}
  defp hidden_types(value) when is_binary(value), do: {:ok, String.split(value, ",", trim: true)}

  defp hidden_types(values) when is_list(values) do
    if Enum.all?(values, &is_binary/1) and length(values) <= length(State.object_types()),
      do: {:ok, values},
      else: hidden_types(:invalid)
  end

  defp hidden_types(_),
    do:
      AgentInterface.error(
        :invalid_object_types,
        "hidden_object_types must be a list of object types.",
        "hidden_object_types"
      )

  defp optional_boolean(nil), do: {:ok, true}
  defp optional_boolean(value) when is_boolean(value), do: {:ok, value}
  defp optional_boolean("true"), do: {:ok, true}
  defp optional_boolean("false"), do: {:ok, false}

  defp optional_boolean(_),
    do:
      AgentInterface.error(
        :invalid_boolean,
        "show_constellations must be true or false.",
        "show_constellations"
      )

  defp event_limit(nil), do: {:ok, @default_event_limit}

  defp event_limit(value) when is_integer(value) and value in 1..@max_event_limit,
    do: {:ok, value}

  defp event_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> event_limit(parsed)
      _ -> event_limit(:invalid)
    end
  end

  defp event_limit(_),
    do:
      AgentInterface.error(
        :invalid_limit,
        "limit must be an integer from 1 through #{@max_event_limit}.",
        "limit"
      )

  defp event(event) do
    %{
      id: event.source <> ":" <> event.source_id,
      kind: event.kind,
      title: event.title,
      summary: event.summary,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      object_key: event.catalog_key,
      object_url: event.catalog_key && object_url(event.catalog_key),
      source: event.source,
      source_url: event.source_url
    }
  end

  defp stale?(nil), do: true

  defp stale?(refreshed_at),
    do: DateTime.diff(DateTime.utc_now(), refreshed_at, :hour) > @stale_event_hours

  defp epoch(nil), do: {:ok, now()}
  defp epoch(""), do: {:ok, now()}
  defp epoch("now"), do: {:ok, now()}

  defp epoch(value) when is_binary(value) and byte_size(value) <= 64 do
    case DateTime.from_iso8601(value) do
      {:ok, parsed, _offset} ->
        utc = parsed |> DateTime.shift_zone!("Etc/UTC") |> DateTime.truncate(:second)
        if utc.year in @min_year..@max_year, do: {:ok, utc}, else: invalid_time()

      _ ->
        invalid_time()
    end
  end

  defp epoch(_), do: invalid_time()

  defp invalid_time,
    do:
      AgentInterface.error(
        :invalid_time,
        "time must be 'now' or an ISO 8601 timestamp with an offset, such as 2026-10-10T00:00:00Z, from year #{@min_year} through #{@max_year}.",
        "time"
      )

  defp now, do: DateTime.utc_now() |> DateTime.truncate(:second)

  defp object_key(value, parameter) when is_binary(value) do
    key = value |> String.trim() |> String.downcase()

    if Regex.match?(~r/^[a-z0-9][a-z0-9:._-]{0,179}$/, key),
      do: {:ok, key},
      else: AgentInterface.error(:invalid_object_key, "#{parameter} is invalid.", parameter)
  end

  defp object_key(nil, parameter),
    do: AgentInterface.error(:missing_object_key, "#{parameter} is required.", parameter)

  defp object_key(_, parameter),
    do: AgentInterface.error(:invalid_object_key, "#{parameter} must be text.", parameter)

  defp optional_float(nil, _parameter, default), do: {:ok, default}
  defp optional_float("", _parameter, default), do: {:ok, default}

  defp optional_float(value, parameter, _default),
    do: required_float(value, parameter, -1.0e6, 1.0e6)

  defp required_float(value, parameter, minimum, maximum) when is_binary(value) do
    case Float.parse(String.trim(value)) do
      {parsed, ""} -> required_float(parsed, parameter, minimum, maximum)
      _ -> invalid_number(parameter, minimum, maximum)
    end
  end

  defp required_float(value, _parameter, minimum, maximum)
       when is_number(value) and value >= minimum and value <= maximum,
       do: {:ok, value * 1.0}

  defp required_float(_value, parameter, minimum, maximum),
    do: invalid_number(parameter, minimum, maximum)

  defp invalid_number(parameter, minimum, maximum),
    do:
      AgentInterface.error(
        :invalid_number,
        "#{parameter} must be a number from #{minimum} through #{maximum}.",
        parameter
      )

  defp invalid_parameters,
    do: AgentInterface.error(:invalid_parameters, "Parameters must be an object.")

  defp located_object(object),
    do: Map.put(named_object(object), :position_au, object.position)

  defp named_object(object) do
    %{
      key: object.key,
      name: object.name,
      object_type: object.object_type,
      object_url: object_url(object.key)
    }
  end

  defp above_horizon?(altitude) when is_number(altitude), do: altitude > 0
  defp above_horizon?(_), do: nil

  defp rounded_position(position),
    do: %{x: round_au(position.x), y: round_au(position.y), z: round_au(position.z)}

  defp round_au(value), do: Float.round(value * 1.0, 9)
  defp difference(a, b), do: %{x: a.x - b.x, y: a.y - b.y, z: a.z - b.z}

  defp norm(vector),
    do: :math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)

  defp present?(nil), do: false
  defp present?(""), do: false
  defp present?(_), do: true

  defp object_url(key), do: absolute_url("/o/" <> URI.encode_www_form(key))
  defp absolute_url(path), do: StarsmapApiWeb.Endpoint.url() <> path
end
