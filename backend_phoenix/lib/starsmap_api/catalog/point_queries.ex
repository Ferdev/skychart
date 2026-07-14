defmodule StarsmapApi.Catalog.PointQueries do
  @moduledoc """
  Owns spatial catalog queries, density cells, point sampling, binary encoding,
  and nearest-object lookup for an atlas viewport.
  """

  import Ecto.Query

  alias StarsmapApi.Catalog.CatalogSourceObject
  alias StarsmapApi.Catalog.PointTileCache
  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.Repo

  @default_density_bins 96
  @max_density_cells 20_000
  @default_point_limit 250_000
  @max_point_limit 1_000_000
  @point_query_timeout 10_000
  @point_cache_version 1
  @point_cache_max_limit 50_000
  @point_cache_max_binary_bytes 2_000_000
  @point_sample_bucket_count 1_024
  @point_layer_groups ~w(gaia_local_stars gaia_500pc_stars gaia_10kpc_bright_stars)
  @point_layer_rgb {224, 196, 128}
  @point_binary_magic "SMP2"

  def list_viewport(params) do
    with {:ok, bounds} <- viewport_bounds(params) do
      limit = bounded_integer(params["limit"], 1_000, 1, 10_000)

      objects =
        CatalogSourceObject
        |> where([object], not is_nil(object.x_au) and not is_nil(object.y_au))
        |> where([object], object.x_au >= ^bounds.min_x_au and object.x_au <= ^bounds.max_x_au)
        |> where([object], object.y_au >= ^bounds.min_y_au and object.y_au <= ^bounds.max_y_au)
        |> maybe_filter_groups(csv_param(params["groups"]))
        |> maybe_filter_types(csv_param(params["types"]))
        |> order_by([object],
          asc_nulls_last: object.apparent_magnitude,
          desc_nulls_last: object.radius_km,
          asc: object.name
        )
        |> limit(^limit)
        |> Repo.all()

      {:ok,
       %{
         bounds: bounds,
         limit: limit,
         total: length(objects),
         objects: Enum.map(objects, &PublicObjects.catalog_object_payload/1)
       }}
    end
  end

  def density(params) do
    with {:ok, bounds} <- viewport_bounds(params) do
      bins = bounded_integer(params["bins"], @default_density_bins, 24, 180)
      groups = csv_param(params["groups"])
      types = csv_param(params["types"])

      {group_sql, group_params} = optional_array_filter("catalog_group", groups, 7)

      {type_sql, type_params} =
        optional_array_filter("object_type", types, 7 + length(group_params))

      sql = """
      WITH binned AS (
        SELECT
          LEAST($5 - 1, GREATEST(0, floor(((x_au - $1) / NULLIF($2 - $1, 0)) * $5)::integer)) AS x_bin,
          LEAST($5 - 1, GREATEST(0, floor(((y_au - $3) / NULLIF($4 - $3, 0)) * $5)::integer)) AS y_bin,
          apparent_magnitude
        FROM catalog_source_objects
        WHERE x_au >= $1
          AND x_au <= $2
          AND y_au >= $3
          AND y_au <= $4
          AND x_au IS NOT NULL
          AND y_au IS NOT NULL
          #{group_sql}
          #{type_sql}
      )
      SELECT
        x_bin,
        y_bin,
        count(*)::integer AS object_count,
        min(apparent_magnitude)::float AS min_magnitude,
        avg(apparent_magnitude)::float AS avg_magnitude
      FROM binned
      GROUP BY x_bin, y_bin
      ORDER BY object_count DESC
      LIMIT $6
      """

      query_params =
        [
          bounds.min_x_au,
          bounds.max_x_au,
          bounds.min_y_au,
          bounds.max_y_au,
          bins,
          @max_density_cells
        ] ++ group_params ++ type_params

      result = Ecto.Adapters.SQL.query!(Repo, sql, query_params)

      cells =
        Enum.map(result.rows, fn [x_bin, y_bin, count, min_magnitude, avg_magnitude] ->
          %{
            x_bin: x_bin,
            y_bin: y_bin,
            count: count,
            min_magnitude: min_magnitude,
            avg_magnitude: avg_magnitude
          }
        end)

      {:ok,
       %{
         bounds: bounds,
         bins: bins,
         groups: groups,
         types: types,
         total: Enum.reduce(cells, 0, &(&1.count + &2)),
         max_cell_count: cells |> Enum.map(& &1.count) |> Enum.max(fn -> 0 end),
         cells: cells
       }}
    end
  end

  def points(params) do
    with {:ok, bounds} <- viewport_bounds(params) do
      limit = bounded_integer(params["limit"], @default_point_limit, 1, @max_point_limit)
      groups = csv_param(params["groups"])
      types = csv_param(params["types"])

      base_query =
        CatalogSourceObject
        |> where([object], not is_nil(object.x_au) and not is_nil(object.y_au))
        |> where([object], object.x_au >= ^bounds.min_x_au and object.x_au <= ^bounds.max_x_au)
        |> where([object], object.y_au >= ^bounds.min_y_au and object.y_au <= ^bounds.max_y_au)
        |> maybe_filter_groups(groups)
        |> maybe_filter_types(types)

      total = Repo.aggregate(base_query, :count, :id)

      points =
        base_query
        |> order_by([object], asc_nulls_last: object.apparent_magnitude)
        |> limit(^limit)
        |> select([object], [
          object.x_au,
          object.y_au,
          object.apparent_magnitude,
          object.color
        ])
        |> Repo.all()

      {:ok,
       %{
         bounds: bounds,
         groups: groups,
         types: types,
         limit: limit,
         total: total,
         returned: length(points),
         points: points
       }}
    end
  end

  def points_binary(params) do
    with {:ok, bounds} <- viewport_bounds(params) do
      limit = bounded_integer(params["limit"], @default_point_limit, 1, @max_point_limit)
      groups = csv_param(params["groups"])
      types = csv_param(params["types"])
      include_total? = truthy_param?(params["include_total"])

      sample_buckets =
        bounded_integer(
          params["sample_buckets"],
          @point_sample_bucket_count,
          1,
          @point_sample_bucket_count
        )

      cache_key =
        point_binary_cache_key(bounds, groups, types, limit, include_total?, sample_buckets)

      if cacheable_point_binary_request?(limit) do
        case PointTileCache.fetch(cache_key) do
          {:ok, payload} ->
            {:ok, Map.put(payload, :cache_status, :hit)}

          :miss ->
            payload =
              build_points_binary_payload(
                bounds,
                groups,
                types,
                limit,
                include_total?,
                sample_buckets
              )

            if byte_size(payload.binary) <= @point_cache_max_binary_bytes do
              PointTileCache.put(cache_key, payload)
            end

            {:ok, Map.put(payload, :cache_status, :miss)}
        end
      else
        payload =
          build_points_binary_payload(
            bounds,
            groups,
            types,
            limit,
            include_total?,
            sample_buckets
          )

        {:ok, Map.put(payload, :cache_status, :bypass)}
      end
    end
  end

  defp cacheable_point_binary_request?(limit), do: limit <= @point_cache_max_limit

  defp build_points_binary_payload(bounds, groups, types, limit, include_total?, sample_buckets) do
    base_query =
      point_base_query(bounds, groups, types)

    total = if include_total?, do: Repo.aggregate(base_query, :count, :id), else: nil

    points =
      if point_layer_query?(groups, types) do
        base_query
        |> maybe_sample_point_layer(sample_buckets)
        |> limit(^limit)
        |> select([object], [
          object.x_au,
          object.y_au,
          object.catalog_group
        ])
        |> Repo.all(timeout: @point_query_timeout)
      else
        base_query
        |> order_by([object], asc_nulls_last: object.apparent_magnitude)
        |> limit(^limit)
        |> select([object], [
          object.x_au,
          object.y_au,
          object.color
        ])
        |> Repo.all(timeout: @point_query_timeout)
      end

    binary = points |> encode_point_binary() |> IO.iodata_to_binary()

    %{
      bounds: bounds,
      groups: groups,
      types: types,
      limit: limit,
      total: total || length(points),
      returned: length(points),
      binary: binary
    }
  end

  defp point_binary_cache_key(bounds, groups, types, limit, include_total?, sample_buckets) do
    {
      :points_binary,
      @point_cache_version,
      bounds.min_x_au,
      bounds.max_x_au,
      bounds.min_y_au,
      bounds.max_y_au,
      Enum.sort(groups),
      Enum.sort(types),
      limit,
      include_total?,
      sample_buckets
    }
  end

  def nearest(params) do
    with {:ok, x_au} <- required_float(params, "x_au"),
         {:ok, y_au} <- required_float(params, "y_au") do
      radius_au = bounded_float(params["radius_au"], 1.0, 0.000001, 10_000_000.0)
      groups = csv_param(params["groups"])
      types = csv_param(params["types"])

      object =
        CatalogSourceObject
        |> where([object], not is_nil(object.x_au) and not is_nil(object.y_au))
        |> where(
          [object],
          object.x_au >= ^(x_au - radius_au) and object.x_au <= ^(x_au + radius_au)
        )
        |> where(
          [object],
          object.y_au >= ^(y_au - radius_au) and object.y_au <= ^(y_au + radius_au)
        )
        |> maybe_filter_groups(groups)
        |> maybe_filter_types(types)
        |> order_by([object],
          asc:
            fragment(
              "((? - ?) * (? - ?)) + ((? - ?) * (? - ?))",
              object.x_au,
              ^x_au,
              object.x_au,
              ^x_au,
              object.y_au,
              ^y_au,
              object.y_au,
              ^y_au
            )
        )
        |> limit(1)
        |> Repo.one()

      {:ok,
       %{
         x_au: x_au,
         y_au: y_au,
         radius_au: radius_au,
         object: if(object, do: PublicObjects.catalog_object_payload(object), else: nil)
       }}
    end
  end

  defp point_base_query(bounds, groups, types) do
    CatalogSourceObject
    |> where([object], not is_nil(object.x_au) and not is_nil(object.y_au))
    |> where([object], object.x_au >= ^bounds.min_x_au and object.x_au <= ^bounds.max_x_au)
    |> where([object], object.y_au >= ^bounds.min_y_au and object.y_au <= ^bounds.max_y_au)
    |> maybe_filter_groups(groups)
    |> maybe_filter_types(types)
  end

  defp point_layer_query?(groups, types) do
    groups != [] and Enum.all?(groups, &(&1 in @point_layer_groups)) and
      (types == [] or types == ["star"])
  end

  defp maybe_sample_point_layer(query, @point_sample_bucket_count), do: query

  defp maybe_sample_point_layer(query, sample_buckets) do
    where(
      query,
      [object],
      fragment(
        "mod(hashtext(?)::bigint + 2147483648, 1024) < ?",
        object.key,
        ^sample_buckets
      )
    )
  end

  defp encode_point_binary(points) do
    count = length(points)

    records =
      Enum.map(points, fn [x_au, y_au, color_or_group] ->
        {red, green, blue} = rgb_for_point_value(color_or_group)

        <<
          float32(x_au)::binary,
          float32(y_au)::binary,
          red::unsigned-integer-size(8),
          green::unsigned-integer-size(8),
          blue::unsigned-integer-size(8),
          0::unsigned-integer-size(8)
        >>
      end)

    [@point_binary_magic, <<count::little-unsigned-integer-size(32)>>, records]
  end

  defp float32(value) when is_number(value), do: <<value::little-float-size(32)>>
  defp float32(_value), do: <<0.0::little-float-size(32)>>

  defp rgb_for_point_value(value) when is_binary(value) do
    if value in @point_layer_groups do
      @point_layer_rgb
    else
      rgb_for_color(value)
    end
  end

  defp rgb_for_point_value(value), do: rgb_for_color(value)

  defp rgb_for_color("#" <> hex) when byte_size(hex) == 6 do
    with {red, ""} <- Integer.parse(binary_part(hex, 0, 2), 16),
         {green, ""} <- Integer.parse(binary_part(hex, 2, 2), 16),
         {blue, ""} <- Integer.parse(binary_part(hex, 4, 2), 16) do
      {red, green, blue}
    else
      _ -> {205, 222, 255}
    end
  end

  defp rgb_for_color(_color), do: {205, 222, 255}

  defp maybe_filter_groups(query, []), do: query

  defp maybe_filter_groups(query, groups) do
    where(query, [object], object.catalog_group in ^groups)
  end

  defp maybe_filter_types(query, []), do: query

  defp maybe_filter_types(query, types) do
    where(query, [object], object.object_type in ^types)
  end

  defp optional_array_filter(_column, [], _param_index), do: {"", []}

  defp optional_array_filter(column, values, param_index) do
    {"AND #{column} = ANY($#{param_index}::text[])", [values]}
  end

  defp viewport_bounds(params) do
    with {:ok, min_x_au} <- required_float(params, "min_x_au"),
         {:ok, max_x_au} <- required_float(params, "max_x_au"),
         {:ok, min_y_au} <- required_float(params, "min_y_au"),
         {:ok, max_y_au} <- required_float(params, "max_y_au") do
      {:ok,
       %{
         min_x_au: min(min_x_au, max_x_au),
         max_x_au: max(min_x_au, max_x_au),
         min_y_au: min(min_y_au, max_y_au),
         max_y_au: max(min_y_au, max_y_au)
       }}
    end
  end

  defp required_float(params, key) do
    params
    |> Map.get(key)
    |> case do
      nil ->
        {:error, {:missing_param, key}}

      value ->
        case Float.parse(value) do
          {number, ""} -> {:ok, number}
          _ -> {:error, {:invalid_float, key}}
        end
    end
  end

  defp bounded_integer(value, default, minimum, maximum) when is_binary(value) do
    case Integer.parse(value) do
      {number, ""} -> min(max(number, minimum), maximum)
      _ -> default
    end
  end

  defp bounded_integer(_value, default, _minimum, _maximum), do: default

  defp bounded_float(value, default, minimum, maximum) when is_binary(value) do
    case Float.parse(value) do
      {number, ""} -> min(max(number, minimum), maximum)
      _ -> default
    end
  end

  defp bounded_float(_value, default, _minimum, _maximum), do: default

  defp truthy_param?(value) when value in ["1", "true", "yes", "on"], do: true
  defp truthy_param?(_value), do: false

  defp csv_param(nil), do: []

  defp csv_param(value) when is_binary(value) do
    value
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end
end
