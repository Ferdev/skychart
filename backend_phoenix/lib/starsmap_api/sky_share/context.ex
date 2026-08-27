defmodule StarsmapApi.SkyShare.Context do
  @moduledoc "Resolves a public observer and server-owned scene inputs for a Sky share."

  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.SkyShare.Ephemeris

  @dynamic_groups ~w(core mars_moons jupiter_major_moons saturn_major_moons jpl_small_bodies)
  @dynamic_core_keys ~w(sun mercury venus earth moon mars phobos deimos jupiter io europa ganymede callisto saturn titan rhea iapetus dione tethys enceladus mimas uranus neptune pluto)
  @au_km 149_597_870.7
  @field_atoms %{
    "key" => :key,
    "name" => :name,
    "object_type" => :object_type,
    "catalog_group" => :catalog_group,
    "position_model" => :position_model,
    "color" => :color,
    "position" => :position,
    "x_au" => :x_au,
    "y_au" => :y_au,
    "z_au" => :z_au,
    "distance_from_earth_km" => :distance_from_earth_km
  }

  def resolve(observer_key, %DateTime{} = epoch) do
    core_result = Ephemeris.snapshot(epoch)
    core_bodies = bodies(core_result)

    case find_body(core_bodies, observer_key) do
      nil -> resolve_catalog_observer(observer_key, epoch, core_result, core_bodies)
      body -> normalize_result(body, core_bodies)
    end
  end

  defp resolve_catalog_observer(observer_key, epoch, core_result, core_bodies) do
    case PublicObjects.public_observer(observer_key) do
      {:ok, object} ->
        if dynamic_object?(object) do
          with {:ok, payload} <- Ephemeris.snapshot(epoch, [observer_key]),
               observer when not is_nil(observer) <-
                 find_body(payload["bodies"] || [], observer_key) do
            normalize_result(observer, merge_bodies(core_bodies, payload["bodies"] || []))
          else
            _ -> {:error, :ephemeris_unavailable}
          end
        else
          normalize_result(object, core_bodies)
        end

      {:error, :not_found} ->
        if observer_key in @dynamic_core_keys and match?({:error, _}, core_result),
          do: {:error, :ephemeris_unavailable},
          else: {:error, :observer_not_found}
    end
  end

  defp normalize_result(body, scene_bodies) do
    with {:ok, position} <- position(body),
         {:ok, key} <- required_string(field(body, "key")),
         {:ok, name} <- required_string(field(body, "name")) do
      earth_position = scene_bodies |> find_body("earth") |> position_or_nil()

      observer = %{
        key: String.downcase(key),
        name: name,
        object_type: optional_string(field(body, "object_type")) || "unknown",
        catalog_group: optional_string(field(body, "catalog_group")),
        color: safe_color(field(body, "color")),
        position: position,
        distance_from_earth_km: distance_from_earth(body, position, earth_position)
      }

      {:ok, observer, scene_bodies}
    else
      _ -> {:error, :invalid_observer_position}
    end
  end

  defp dynamic_object?(object) do
    group = optional_string(field(object, "catalog_group"))
    model = optional_string(field(object, "position_model")) || ""
    group in @dynamic_groups or String.contains?(model, ["spice", "horizons", "ephemeris"])
  end

  defp bodies({:ok, payload}) when is_map(payload),
    do: payload["bodies"] || payload[:bodies] || []

  defp bodies(_), do: []

  defp merge_bodies(left, right) do
    (left ++ right)
    |> Enum.reduce(%{}, fn body, acc ->
      case optional_string(field(body, "key")) do
        nil -> acc
        key -> Map.put(acc, String.downcase(key), body)
      end
    end)
    |> Map.values()
  end

  defp find_body(bodies, key) when is_list(bodies) do
    normalized = String.downcase(key)
    Enum.find(bodies, &(String.downcase(optional_string(field(&1, "key")) || "") == normalized))
  end

  defp find_body(_, _), do: nil

  defp position_or_nil(nil), do: nil

  defp position_or_nil(body) do
    case position(body) do
      {:ok, value} -> value
      _ -> nil
    end
  end

  defp position(body) do
    source = field(body, "position") || body

    with {:ok, x} <- finite_number(field(source, "x_au")),
         {:ok, y} <- finite_number(field(source, "y_au")),
         {:ok, z} <- finite_number(field(source, "z_au")),
         key <- String.downcase(optional_string(field(body, "key")) || ""),
         true <- key == "sun" or :math.sqrt(x * x + y * y + z * z) > 1.0e-12 do
      {:ok, %{x: x, y: y, z: z}}
    else
      _ -> {:error, :invalid_position}
    end
  end

  defp distance_from_earth(body, observer, earth) do
    supplied = field(body, "distance_from_earth_km")

    cond do
      finite?(supplied) and supplied >= 0 ->
        supplied * 1.0

      earth ->
        :math.sqrt(
          square(observer.x - earth.x) + square(observer.y - earth.y) +
            square(observer.z - earth.z)
        ) * @au_km

      true ->
        nil
    end
  end

  defp field(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, @field_atoms[key])
  defp field(_, _), do: nil

  defp finite_number(value) when is_number(value) do
    value = value * 1.0
    if finite?(value), do: {:ok, value}, else: {:error, :invalid_number}
  end

  defp finite_number(_), do: {:error, :invalid_number}
  defp finite?(value), do: is_number(value) and value == value and abs(value) < 1.0e300
  defp square(value), do: value * value

  defp required_string(value) do
    case optional_string(value) do
      nil -> {:error, :missing_string}
      string -> {:ok, string}
    end
  end

  defp optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp optional_string(_), do: nil

  defp safe_color(value) when is_binary(value) do
    if Regex.match?(~r/^#[0-9a-fA-F]{6}$/, value), do: value, else: "#d8e8ff"
  end

  defp safe_color(_), do: "#d8e8ff"
end
