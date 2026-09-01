defmodule StarsmapApi.AgentInterface do
  @moduledoc "Bounded read-only operations shared by the public agent API."

  alias StarsmapApi.AgentCatalogs
  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.Catalog.Search

  @min_query_length 3
  @max_query_length 80
  @default_limit 5
  @max_limit 10
  @min_zoom 1.0e-14
  @max_zoom 50_000_000.0
  @max_coordinate_au 3.0e15

  def search(params) when is_map(params) do
    with {:ok, query} <- query(params["q"]),
         {:ok, limit} <- limit(params["limit"]) do
      payload = Search.search(%{"q" => query, "limit" => Integer.to_string(limit)})

      {:ok,
       %{
         query: query,
         limit: limit,
         count: min(length(payload.objects), limit),
         has_more: payload.has_more,
         results: Enum.map(payload.objects, &summary/1),
         documentation_url: absolute_url("/agents")
       }}
    end
  end

  def object(key) when is_binary(key) do
    case PublicObjects.public_object(key) do
      {:ok, object} ->
        catalog = AgentCatalogs.find(object.catalog_group)

        {:ok,
         %{
           object: %{
             key: object.key,
             name: object.name,
             aliases: object.aliases,
             object_type: object.object_type,
             catalog_id: object.catalog_group,
             astrometry: object.astrometry,
             identifiers: object.external_ids,
             semantics: object.semantics
           },
           provenance: %{
             source_type: object.source_type,
             catalog: catalog,
             record_links: object.external_links
           },
           links: object_links(object),
           documentation_url: absolute_url("/agents")
         }}

      {:error, :not_found} ->
        error(:object_not_found, "No public SkyChart object record matches that key.", "key")
    end
  end

  def object(_), do: error(:invalid_object_key, "Object keys must be text.", "key")

  def catalogs do
    %{
      catalogs: AgentCatalogs.catalogs(),
      display_layers: AgentCatalogs.display_layers(),
      coordinate_frame:
        "heliocentric ecliptic map plane; center coordinates are astronomical units",
      documentation_url: absolute_url("/agents"),
      data_notice_url: "https://github.com/Ferdev/skychart/blob/trunk/DATA-NOTICE.md"
    }
  end

  def view_link(params) when is_map(params) do
    with {:ok, object} <- optional_object(params["object_key"]),
         {:ok, center} <- center(params, object),
         {:ok, zoom} <- zoom(params["zoom"]),
         {:ok, time} <- time(params["time"]),
         {:ok, layers} <- layers(params["layers"]) do
      query =
        [
          {"v", "1"},
          {"c", number(center.x) <> "," <> number(center.y)},
          {"z", number(zoom)},
          {"t", time}
        ]
        |> maybe_put_object(object)
        |> Kernel.++([{"L", layer_flags(layers)}])
        |> URI.encode_query()

      {:ok,
       %{
         url: absolute_url("/?" <> query),
         object_url: object && absolute_url("/o/" <> URI.encode_www_form(object.key)),
         parameters: %{
           center_x_au: center.x,
           center_y_au: center.y,
           zoom_px_per_au: zoom,
           time: time,
           object_key: object && object.key,
           visible_layers: layers
         },
         coordinate_frame: "heliocentric ecliptic map plane",
         limitation:
           "center_x_au and center_y_au are physical map-plane coordinates, not right ascension and declination. Use an object_key for named-object views."
       }}
    end
  end

  def view_link(_), do: error(:invalid_parameters, "View-link parameters must be an object.")

  def error(code, message, parameter \\ nil) do
    {:error, %{code: Atom.to_string(code), message: message, parameter: parameter}}
  end

  defp query(value) when is_binary(value) do
    query = String.trim(value)

    if String.length(query) in @min_query_length..@max_query_length,
      do: {:ok, query},
      else:
        error(
          :invalid_query,
          "q must contain between #{@min_query_length} and #{@max_query_length} characters.",
          "q"
        )
  end

  defp query(_), do: error(:missing_query, "q is required.", "q")

  defp limit(nil), do: {:ok, @default_limit}

  defp limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} when parsed in 1..@max_limit ->
        {:ok, parsed}

      _ ->
        error(:invalid_limit, "limit must be an integer from 1 through #{@max_limit}.", "limit")
    end
  end

  defp limit(value) when is_integer(value), do: limit(Integer.to_string(value))
  defp limit(_), do: error(:invalid_limit, "limit must be an integer.", "limit")

  defp optional_object(nil), do: {:ok, nil}
  defp optional_object(""), do: {:ok, nil}

  defp optional_object(key) when is_binary(key) and byte_size(key) <= 180 do
    case PublicObjects.public_object(String.downcase(String.trim(key))) do
      {:ok, object} ->
        {:ok, object}

      {:error, :not_found} ->
        error(:object_not_found, "No public SkyChart object matches object_key.", "object_key")
    end
  end

  defp optional_object(_), do: error(:invalid_object_key, "object_key is invalid.", "object_key")

  defp center(params, object) do
    x = params["center_x_au"]
    y = params["center_y_au"]

    cond do
      present?(x) or present?(y) ->
        with {:ok, x_value} <-
               finite_float(x, "center_x_au", -@max_coordinate_au, @max_coordinate_au),
             {:ok, y_value} <-
               finite_float(y, "center_y_au", -@max_coordinate_au, @max_coordinate_au) do
          {:ok, %{x: x_value, y: y_value}}
        end

      object && finite_number?(object.position.x_au) && finite_number?(object.position.y_au) ->
        {:ok, %{x: object.position.x_au, y: object.position.y_au}}

      object ->
        error(
          :coordinates_not_available,
          "This object has no validated physical map-plane coordinates; use its object_url instead.",
          "object_key"
        )

      true ->
        error(
          :missing_coordinates,
          "Provide both center_x_au and center_y_au, or provide object_key.",
          "center_x_au"
        )
    end
  end

  defp zoom(nil), do: {:ok, 24.0}
  defp zoom(value), do: finite_float(value, "zoom", @min_zoom, @max_zoom)

  defp time(nil), do: {:ok, "now"}
  defp time("now"), do: {:ok, "now"}

  defp time(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _offset} ->
        {:ok, datetime |> DateTime.shift_zone!("Etc/UTC") |> DateTime.to_iso8601()}

      _ ->
        error(:invalid_time, "time must be 'now' or an ISO 8601 timestamp.", "time")
    end
  end

  defp time(_), do: error(:invalid_time, "time must be text.", "time")

  defp layers(nil), do: {:ok, AgentCatalogs.display_layer_ids()}

  defp layers(value) when is_binary(value) do
    requested =
      value
      |> String.split(",", trim: true)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    invalid = requested -- AgentCatalogs.display_layer_ids()

    if invalid == [],
      do: {:ok, requested},
      else:
        error(
          :invalid_layers,
          "Unsupported layer identifier(s): #{Enum.join(invalid, ", ")}.",
          "layers"
        )
  end

  defp layers(_), do: error(:invalid_layers, "layers must be a comma-separated string.", "layers")

  defp finite_float(value, parameter, minimum, maximum) when is_binary(value) do
    case Float.parse(value) do
      {parsed, ""} when parsed >= minimum and parsed <= maximum ->
        {:ok, parsed}

      _ ->
        error(
          :invalid_number,
          "#{parameter} must be a finite number from #{minimum} through #{maximum}.",
          parameter
        )
    end
  end

  defp finite_float(value, parameter, minimum, maximum) when is_number(value),
    do: finite_float(to_string(value), parameter, minimum, maximum)

  defp finite_float(_value, parameter, _minimum, _maximum),
    do: error(:invalid_number, "#{parameter} is required and must be numeric.", parameter)

  defp layer_flags(visible) do
    AgentCatalogs.display_layer_ids()
    |> Enum.sort()
    |> Enum.map_join("~", fn layer ->
      URI.encode_www_form(layer) <> if(layer in visible, do: ".1", else: ".0")
    end)
  end

  defp maybe_put_object(query, nil), do: query
  defp maybe_put_object(query, object), do: query ++ [{"o", object.key}]

  defp object_links(object) do
    %{
      human: absolute_url("/o/" <> URI.encode_www_form(object.key)),
      api: absolute_url("/api/agent/v1/objects/" <> URI.encode_www_form(object.key))
    }
  end

  defp summary(object) do
    %{
      key: object.key,
      name: object.name,
      object_type: object.object_type,
      catalog_id: object.catalog_group,
      source_type: object.source_type,
      right_ascension_deg: object.astrometry.ra_deg,
      declination_deg: object.astrometry.dec_deg,
      distance_ly: object.astrometry.distance_ly,
      apparent_magnitude: object.astrometry.apparent_magnitude,
      links: %{
        object: absolute_url("/o/" <> URI.encode_www_form(object.key)),
        api: absolute_url("/api/agent/v1/objects/" <> URI.encode_www_form(object.key))
      }
    }
  end

  defp absolute_url(path), do: StarsmapApiWeb.Endpoint.url() <> path
  defp present?(nil), do: false
  defp present?(""), do: false
  defp present?(_), do: true

  defp finite_number?(value) when is_number(value),
    do: value == value and value not in [:infinity, :neg_infinity]

  defp finite_number?(_), do: false

  defp number(value) when is_integer(value), do: Integer.to_string(value)

  defp number(value) when is_float(value) do
    if value == trunc(value),
      do: Integer.to_string(trunc(value)),
      else: :erlang.float_to_binary(value, [:compact, decimals: 15])
  end
end
