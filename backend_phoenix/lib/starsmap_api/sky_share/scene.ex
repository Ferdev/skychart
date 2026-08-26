defmodule StarsmapApi.SkyShare.Scene do
  @moduledoc "Builds observer-relative catalog and dynamic-body directions for Sky cards."

  alias StarsmapApi.Catalog.PointQueries
  alias StarsmapApi.SkyShare.State

  @point_limit 2_400

  def build(%State{} = state, observer, ephemeris_bodies) do
    catalog = catalog_points(observer)
    dynamic = dynamic_points(observer, ephemeris_bodies)

    (catalog ++ dynamic)
    |> Enum.reduce(%{}, fn point, acc -> Map.put(acc, point.key, point) end)
    |> Map.values()
    |> Enum.reject(&(&1.type in state.hidden_object_types))
    |> Enum.sort_by(&{if(&1.dynamic, do: 1, else: 0), magnitude(&1.magnitude), &1.key})
  rescue
    _ ->
      dynamic_points(observer, ephemeris_bodies)
      |> Enum.reject(&(&1.type in state.hidden_object_types))
  end

  defp catalog_points(observer) do
    params = %{
      "observer_key" => observer.key,
      "observer_x_au" => number(observer.position.x),
      "observer_y_au" => number(observer.position.y),
      "observer_z_au" => number(observer.position.z),
      "limit" => Integer.to_string(@point_limit)
    }

    case PointQueries.sky(params) do
      {:ok, %{points: points}} -> Enum.flat_map(points, &normalize_catalog_point/1)
      _ -> []
    end
  end

  defp normalize_catalog_point(point) do
    direction = value(point, :direction)

    with key when is_binary(key) <- value(point, :key),
         name when is_binary(name) <- value(point, :name),
         {:ok, vector} <- vector(direction) do
      [
        %{
          key: key,
          name: name,
          type: normalize_type(value(point, :object_type)),
          color: safe_color(value(point, :color)),
          magnitude: finite_or_nil(value(point, :apparent_magnitude)),
          direction: vector,
          dynamic: false
        }
      ]
    else
      _ -> []
    end
  end

  defp dynamic_points(observer, bodies) when is_list(bodies) do
    Enum.flat_map(bodies, fn body ->
      with key when is_binary(key) <- value(body, :key),
           false <- String.downcase(key) == observer.key,
           position when is_map(position) <- value(body, :position),
           {:ok, target} <- position_vector(position),
           {:ok, direction} <- relative(observer.position, target) do
        [
          %{
            key: String.downcase(key),
            name: string(value(body, :name), key),
            type: normalize_type(value(body, :object_type)),
            color: safe_color(value(body, :color)),
            magnitude: body_magnitude(body),
            direction: direction,
            dynamic: true
          }
        ]
      else
        _ -> []
      end
    end)
  end

  defp dynamic_points(_, _), do: []

  defp body_magnitude(body) do
    stellar = value(body, :stellar) || %{}
    deep_sky = value(body, :deep_sky) || %{}

    finite_or_nil(value(stellar, :apparent_magnitude)) ||
      finite_or_nil(value(deep_sky, :apparent_magnitude))
  end

  defp position_vector(position) do
    vector(%{x: value(position, :x_au), y: value(position, :y_au), z: value(position, :z_au)})
  end

  defp relative(observer, target) do
    vector(%{x: target.x - observer.x, y: target.y - observer.y, z: target.z - observer.z})
  end

  defp vector(vector) when is_map(vector) do
    x = value(vector, :x)
    y = value(vector, :y)
    z = value(vector, :z)

    if Enum.all?([x, y, z], &finite?/1) do
      length = :math.sqrt(x * x + y * y + z * z)

      if length > 1.0e-12,
        do: {:ok, %{x: x / length, y: y / length, z: z / length}},
        else: {:error, :zero_vector}
    else
      {:error, :invalid_vector}
    end
  end

  defp vector(_), do: {:error, :invalid_vector}

  defp value(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp value(_, _), do: nil
  defp finite?(value), do: is_number(value) and value == value and abs(value) < 1.0e300
  defp finite_or_nil(value), do: if(finite?(value), do: value * 1.0, else: nil)
  defp magnitude(nil), do: 1.0e9
  defp magnitude(value), do: value
  defp string(value, _fallback) when is_binary(value) and value != "", do: value
  defp string(_, fallback), do: fallback

  defp normalize_type(value) when is_binary(value) do
    type = value |> String.trim() |> String.downcase()
    if type in State.object_types(), do: type, else: "unknown"
  end

  defp normalize_type(_), do: "unknown"

  defp safe_color(value) when is_binary(value) do
    if Regex.match?(~r/^#[0-9a-fA-F]{6}$/, value), do: String.downcase(value), else: "#d8e8ff"
  end

  defp safe_color(_), do: "#d8e8ff"
  defp number(value), do: :erlang.float_to_binary(value * 1.0, [:compact, decimals: 12])
end
