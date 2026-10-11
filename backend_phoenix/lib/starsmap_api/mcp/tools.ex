defmodule StarsmapApi.Mcp.Tools do
  @moduledoc """
  The public read-only MCP tools. Each tool is a thin name and schema over a bounded
  operation of `StarsmapApi.AgentInterface` or `StarsmapApi.AgentSky`, so the MCP
  transport and the REST agent API cannot disagree about search, provenance, or links.
  """

  alias StarsmapApi.AgentCatalogs
  alias StarsmapApi.AgentInterface
  alias StarsmapApi.AgentSky

  @scope "For atlas orientation, source discovery, and shareable links; not an authoritative archive, a bulk data service, or an observing planner."
  @time_description "UTC epoch as 'now' or an ISO 8601 timestamp with an offset, for example 2026-10-10T00:00:00Z. The default is now."
  @annotations %{
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }

  def names, do: Enum.map(list(), & &1.name)

  def list do
    [
      tool(
        "search_sky_objects",
        "Search sky objects",
        "Find named objects in the SkyChart catalog index: stars, planets, moons, spacecraft, small bodies, exoplanet systems, galaxies, quasars, X-ray sources, and deep-sky objects. Returns object keys, types, coordinates, and links. Use a returned key exactly as given in the other tools.",
        %{
          q: %{
            type: "string",
            minLength: 3,
            maxLength: 80,
            description:
              "Name, alias, or catalog designation, for example 'Andromeda', 'M31', 'Voyager 1', or 'NGC 224'."
          },
          limit: %{
            type: "integer",
            minimum: 1,
            maximum: 10,
            default: 5,
            description: "Maximum number of results."
          }
        },
        ["q"]
      ),
      tool(
        "get_sky_object",
        "Get a sky object record",
        "Get one public object record: names and aliases, type, astrometry, identifiers, scientific semantics, source catalog, upstream record links, and the stable SkyChart object page.",
        %{key: key_property("Object key from search_sky_objects, for example 'ngc-224'.")},
        ["key"]
      ),
      tool(
        "list_sky_catalogs",
        "List catalogs and display layers",
        "List the catalogs and ephemerides in the atlas, with the upstream source, the coverage, and the selection caveat of each one, and the display-layer identifiers that create_sky_view_link accepts.",
        %{},
        []
      ),
      tool(
        "create_sky_view_link",
        "Create an atlas view link",
        "Build a validated, shareable link to the 2D atlas, centered on a named object or on map-plane coordinates, at a given zoom, epoch, and set of visible layers. Give object_key, or both center_x_au and center_y_au. The coordinates are heliocentric ecliptic astronomical units, not right ascension and declination.",
        %{
          object_key: key_property("Object to select and to center, from search_sky_objects."),
          center_x_au: %{
            type: "number",
            description: "Map-plane x of the view center in AU."
          },
          center_y_au: %{
            type: "number",
            description: "Map-plane y of the view center in AU."
          },
          zoom: %{
            type: "number",
            exclusiveMinimum: 0,
            default: 24,
            description:
              "Scale in pixels per AU. 24 shows the inner Solar System; 0.02 shows the nearest stars; smaller values show the galaxy and beyond."
          },
          time: %{
            type: "string",
            description:
              "'now' for a live view, or an ISO 8601 timestamp for a fixed epoch. The default is now."
          },
          layers: %{
            type: "array",
            uniqueItems: true,
            items: %{type: "string", enum: AgentCatalogs.display_layer_ids()},
            description: "Display layers to show. The default shows all layers."
          }
        },
        []
      ),
      tool(
        "create_object_sky_link",
        "Create a sky-from-an-object link",
        "Build a shareable link to the Sky view: the geometric sky as seen from a planet, moon, spacecraft, star, or other object with a three-dimensional atlas position. Give look_at_key to aim the view at another object (for example Earth seen from Mars), or give yaw_deg and pitch_deg. Returns the link and a preview image address.",
        %{
          observer_key: key_property("Object to stand on, for example 'mars' or 'earth'."),
          look_at_key: key_property("Object to put at the center of the view."),
          yaw_deg: %{
            type: "number",
            default: 0,
            description: "Ecliptic longitude of the view direction in degrees."
          },
          pitch_deg: %{
            type: "number",
            minimum: -89.5,
            maximum: 89.5,
            default: 0,
            description: "Ecliptic latitude of the view direction in degrees."
          },
          fov_deg: %{
            type: "number",
            minimum: 20,
            maximum: 110,
            default: 72,
            description: "Field of view in degrees."
          },
          time: %{type: "string", description: @time_description},
          show_constellations: %{
            type: "boolean",
            default: true,
            description: "Show constellation lines."
          },
          hidden_object_types: %{
            type: "array",
            uniqueItems: true,
            items: %{type: "string", enum: AgentSky.sky_object_types()},
            description: "Object types to hide."
          },
          locale: %{
            type: "string",
            enum: AgentSky.sky_locales(),
            default: "en",
            description: "Language of the page."
          }
        },
        ["observer_key"]
      ),
      tool(
        "get_solar_system_positions",
        "Get Solar System positions",
        "Get where the Sun, the planets, the Moon, Pluto, major moons, and tracked spacecraft are at a given time: heliocentric ecliptic position, distance from the Sun, distance from Earth, and light-travel time from Earth.",
        %{
          time: %{type: "string", description: @time_description},
          bodies: %{
            type: "array",
            uniqueItems: true,
            maxItems: 24,
            items: %{type: "string"},
            description:
              "Keys to return. Accepted: #{Enum.join(AgentSky.core_bodies(), ", ")}, and at most 4 spacecraft keys from search_sky_objects (spacecraft-...). The default is the Sun, the planets, the Moon, and Pluto."
          }
        },
        []
      ),
      tool(
        "measure_object_separation",
        "Measure the separation of two objects",
        "Measure the straight-line distance between two atlas objects in AU, kilometers, light-years, and parsecs, with the light-travel time. Works across scales: planets, spacecraft, stars, and galaxies with a three-dimensional atlas position. Solar System bodies use the ephemeris at the given time.",
        %{
          from_key: key_property("First object key, from search_sky_objects."),
          to_key: key_property("Second object key, from search_sky_objects."),
          time: %{type: "string", description: @time_description}
        },
        ["from_key", "to_key"]
      ),
      tool(
        "get_object_visibility",
        "Get visibility from a place on Earth",
        "Estimate where an object is in the sky now from a place on Earth: altitude, azimuth, and the rise, transit, and set times in the next 24 hours. Modeled for the Sun, the Moon, the planets and major moons, Hipparcos bright stars, exoplanet host systems, and Messier objects. Geometric five-minute sampling without refraction, daylight, or weather.",
        %{
          object_key:
            key_property("Object key, for example 'jupiter', 'moon', 'm31', or 'hip-32349'."),
          latitude_deg: %{
            type: "number",
            minimum: -90,
            maximum: 90,
            description: "Observer latitude in degrees; north is positive."
          },
          longitude_deg: %{
            type: "number",
            minimum: -180,
            maximum: 180,
            description: "Observer longitude in degrees; east is positive."
          }
        },
        ["object_key", "latitude_deg", "longitude_deg"]
      ),
      tool(
        "list_sky_events",
        "List current sky events",
        "List recent and upcoming events that the atlas tracks, such as near-Earth object close approaches from JPL CNEOS and newly confirmed exoplanets from the NASA Exoplanet Archive, with their source links.",
        %{
          limit: %{
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 10,
            description: "Maximum number of events."
          }
        },
        []
      ),
      tool(
        "list_guided_tours",
        "List guided tours",
        "List the guided tours of the atlas, with the title, the text, and the link of each step. Use it to recommend a narrated journey through the atlas.",
        %{},
        []
      )
    ]
  end

  @doc """
  Runs one tool. An invalid argument is an `{:error, map}` tool result that a model
  can correct; `:unknown_tool` is a protocol error.
  """
  def call(name, arguments) when is_binary(name) and is_map(arguments) do
    case Enum.find(list(), &(&1.name == name)) do
      nil ->
        :unknown_tool

      tool ->
        allowed = Enum.map(Map.keys(tool.inputSchema.properties), &Atom.to_string/1)

        case Map.keys(arguments) -- allowed do
          [] ->
            run(name, arguments)

          [unknown | _] ->
            AgentInterface.error(
              :unknown_argument,
              "#{name} accepts only these arguments: #{Enum.join(allowed, ", ")}.",
              String.slice(to_string(unknown), 0, 80)
            )
        end
    end
  end

  defp run("search_sky_objects", arguments), do: AgentInterface.search(arguments)

  defp run("get_sky_object", %{"key" => key}) when is_binary(key),
    do: AgentInterface.object(String.trim(key))

  defp run("get_sky_object", arguments), do: AgentInterface.object(arguments["key"])
  defp run("list_sky_catalogs", _arguments), do: {:ok, AgentInterface.catalogs()}

  defp run("create_sky_view_link", arguments),
    do: arguments |> comma_separated("layers") |> AgentInterface.view_link()

  defp run("create_object_sky_link", arguments), do: AgentSky.sky_link(arguments)
  defp run("get_solar_system_positions", arguments), do: AgentSky.positions(arguments)
  defp run("measure_object_separation", arguments), do: AgentSky.separation(arguments)
  defp run("get_object_visibility", arguments), do: AgentSky.visibility(arguments)
  defp run("list_sky_events", arguments), do: AgentSky.events(arguments)
  defp run("list_guided_tours", _arguments), do: {:ok, AgentSky.tours()}

  # The REST view-link operation takes its layers as one comma-separated value.
  defp comma_separated(arguments, name) do
    case arguments[name] do
      values when is_list(values) ->
        if Enum.all?(values, &is_binary/1),
          do: Map.put(arguments, name, Enum.join(values, ",")),
          else: arguments

      _ ->
        arguments
    end
  end

  defp tool(name, title, description, properties, required) do
    %{
      name: name,
      title: title,
      description: description <> " " <> @scope,
      inputSchema: input_schema(properties, required),
      annotations: Map.put(@annotations, :title, title)
    }
  end

  defp input_schema(properties, []),
    do: %{type: "object", properties: properties, additionalProperties: false}

  defp input_schema(properties, required),
    do: Map.put(input_schema(properties, []), :required, required)

  defp key_property(description),
    do: %{type: "string", minLength: 1, maxLength: 180, description: description}
end
