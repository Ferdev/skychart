defmodule StarsmapApi.Catalog do
  @moduledoc """
  Query boundary for large scientific catalogs.

  This context is intentionally catalog-only. Dynamic ephemeris generation and
  source-specific ingestion remain separate so the UI can page/search millions of
  mostly-static records without asking the scientific pipeline to hydrate every
  object on startup.
  """

  import Ecto.Query

  alias StarsmapApi.Catalog.CatalogObject
  alias StarsmapApi.Catalog.PointTileCache
  alias StarsmapApi.Repo

  @default_limit 80
  @max_limit 500
  @default_density_bins 96
  @max_density_cells 20_000
  @default_point_limit 250_000
  @max_point_limit 1_000_000
  @search_timeout 5_000
  @summary_timeout 120_000
  @point_query_timeout 10_000
  @point_cache_version 1
  @point_cache_max_limit 50_000
  @point_cache_max_binary_bytes 2_000_000
  @point_sample_bucket_count 1_024
  @point_layer_groups ~w(gaia_local_stars gaia_500pc_stars gaia_10kpc_bright_stars)
  @point_layer_rgb {224, 196, 128}
  @point_binary_magic "SMP2"
  @upsert_replace_fields [
    :name,
    :object_type,
    :catalog_group,
    :source_type,
    :position_model,
    :parent_key,
    :color,
    :radius_km,
    :ra_deg,
    :dec_deg,
    :distance_pc,
    :distance_ly,
    :x_au,
    :y_au,
    :z_au,
    :x_km,
    :y_km,
    :z_km,
    :apparent_magnitude,
    :absolute_magnitude,
    :search_text,
    :aliases,
    :external_ids,
    :facts,
    :source,
    :updated_at
  ]

  def upsert_objects(objects) when is_list(objects) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    rows =
      Enum.map(objects, fn object ->
        object
        |> Map.put(:inserted_at, now)
        |> Map.put(:updated_at, now)
      end)

    result =
      rows
      |> Enum.chunk_every(1_000)
      |> Enum.reduce({0, nil}, fn chunk, {count, _returning} ->
        {inserted_count, returning} =
          Repo.insert_all(CatalogObject, chunk,
            on_conflict: {:replace, @upsert_replace_fields},
            conflict_target: :key
          )

        {count + inserted_count, returning}
      end)

    PointTileCache.clear()

    result
  end

  def summary do
    case cached_summary() do
      {:ok, summary} -> summary
      :error -> live_summary()
    end
  end

  def refresh_summary_counts! do
    sql = """
    INSERT INTO catalog_summary_counts (bucket, name, count, inserted_at, updated_at)
    SELECT bucket, name, total, now(), now()
    FROM (
      SELECT 'total'::text AS bucket, 'object_count'::text AS name, COUNT(*)::bigint AS total
      FROM catalog_objects
      UNION ALL
      SELECT 'catalog_group'::text AS bucket, catalog_group AS name, COUNT(*)::bigint AS total
      FROM catalog_objects
      GROUP BY catalog_group
      UNION ALL
      SELECT 'object_type'::text AS bucket, object_type AS name, COUNT(*)::bigint AS total
      FROM catalog_objects
      GROUP BY object_type
      UNION ALL
      SELECT 'source_type'::text AS bucket, source_type AS name, COUNT(*)::bigint AS total
      FROM catalog_objects
      GROUP BY source_type
    ) counts
    ON CONFLICT (bucket, name)
    DO UPDATE SET count = EXCLUDED.count, updated_at = EXCLUDED.updated_at
    """

    Repo.transaction(
      fn ->
        Repo.query!("TRUNCATE catalog_summary_counts", [], timeout: @summary_timeout)
        Repo.query!(sql, [], timeout: @summary_timeout)
      end,
      timeout: @summary_timeout
    )

    :ok
  end

  defp cached_summary do
    rows =
      Repo.query!("SELECT bucket, name, count FROM catalog_summary_counts", [], timeout: 5_000).rows

    counts =
      Enum.reduce(rows, %{}, fn [bucket, name, count], acc ->
        Map.update(acc, bucket, %{name => count}, &Map.put(&1, name, count))
      end)

    group_counts = Map.get(counts, "catalog_group", %{})
    object_count = get_in(counts, ["total", "object_count"])

    if object_count && map_size(group_counts) > 0 do
      {:ok,
       %{
         object_count: object_count,
         group_counts: group_counts,
         type_counts: Map.get(counts, "object_type", %{}),
         source_counts: Map.get(counts, "source_type", %{})
       }}
    else
      :error
    end
  rescue
    Postgrex.Error -> :error
  end

  defp live_summary do
    group_counts =
      CatalogObject
      |> group_by([object], object.catalog_group)
      |> select([object], {object.catalog_group, count(object.id)})
      |> Repo.all(timeout: @summary_timeout)
      |> Map.new()

    type_counts =
      CatalogObject
      |> group_by([object], object.object_type)
      |> select([object], {object.object_type, count(object.id)})
      |> Repo.all(timeout: @summary_timeout)
      |> Map.new()

    source_counts =
      CatalogObject
      |> group_by([object], object.source_type)
      |> select([object], {object.source_type, count(object.id)})
      |> Repo.all(timeout: @summary_timeout)
      |> Map.new()

    %{
      object_count: Enum.sum(Map.values(group_counts)),
      group_counts: group_counts,
      type_counts: type_counts,
      source_counts: source_counts
    }
  end

  def search(params) do
    limit = bounded_integer(params["limit"], @default_limit, 1, @max_limit)
    offset = bounded_integer(params["offset"], 0, 0, 10_000_000)
    query_text = string_param(params["q"])
    groups = csv_param(params["groups"])
    types = csv_param(params["types"])

    if short_interactive_query?(query_text) do
      %{
        query: query_text,
        groups: groups,
        types: types,
        offset: offset,
        limit: limit,
        total: 0,
        has_more: false,
        objects: []
      }
    else
      search_catalog_objects(query_text, groups, types, offset, limit)
    end
  end

  defp search_catalog_objects(query_text, groups, types, offset, limit) do
    base_query =
      CatalogObject
      |> maybe_filter_groups(groups)
      |> maybe_filter_types(types)
      |> maybe_filter_query(query_text)

    objects =
      base_query
      |> order_for_search(query_text)
      |> limit(^(limit + 1))
      |> offset(^offset)
      |> Repo.all(timeout: @search_timeout)

    has_more = length(objects) > limit
    visible_objects = Enum.take(objects, limit)

    %{
      query: query_text,
      groups: groups,
      types: types,
      offset: offset,
      limit: limit,
      total: offset + length(visible_objects) + if(has_more, do: 1, else: 0),
      has_more: has_more,
      objects: Enum.map(visible_objects, &catalog_object_payload/1)
    }
  end

  defp short_interactive_query?(""), do: false
  defp short_interactive_query?(query_text), do: String.length(query_text) < 3

  def list_viewport(params) do
    with {:ok, bounds} <- viewport_bounds(params) do
      limit = bounded_integer(params["limit"], 1_000, 1, 10_000)

      objects =
        CatalogObject
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
         objects: Enum.map(objects, &catalog_object_payload/1)
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
        FROM catalog_objects
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
        CatalogObject
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
        CatalogObject
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
         object: if(object, do: catalog_object_payload(object), else: nil)
       }}
    end
  end

  def get_by_key(key) when is_binary(key) do
    CatalogObject
    |> Repo.get_by(key: String.downcase(key))
    |> case do
      nil -> {:error, :not_found}
      object -> {:ok, catalog_object_payload(object)}
    end
  end

  defp point_base_query(bounds, groups, types) do
    CatalogObject
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

  def external_links_by_key(key) when is_binary(key) do
    CatalogObject
    |> Repo.get_by(key: String.downcase(key))
    |> case do
      nil -> {:error, :not_found}
      object -> {:ok, external_links(object)}
    end
  end

  def catalog_object_payload(%CatalogObject{} = object) do
    %{
      key: object.key,
      name: object.name,
      object_type: object.object_type,
      catalog_group: object.catalog_group,
      source_type: object.source_type,
      position_model: object.position_model,
      parent_key: object.parent_key,
      color: object.color,
      radius_km: object.radius_km,
      aliases: object.aliases || [],
      external_ids: object.external_ids || %{},
      external_links: external_links(object),
      source: object.source || %{},
      facts: object.facts || %{},
      astrometry: %{
        ra_deg: object.ra_deg,
        dec_deg: object.dec_deg,
        distance_pc: object.distance_pc,
        distance_ly: object.distance_ly,
        apparent_magnitude: object.apparent_magnitude,
        absolute_magnitude: object.absolute_magnitude
      },
      position: %{
        x_au: object.x_au,
        y_au: object.y_au,
        z_au: object.z_au,
        x_km: object.x_km,
        y_km: object.y_km,
        z_km: object.z_km
      }
    }
  end

  defp maybe_filter_groups(query, []), do: query

  defp maybe_filter_groups(query, groups) do
    where(query, [object], object.catalog_group in ^groups)
  end

  defp maybe_filter_types(query, []), do: query

  defp maybe_filter_types(query, types) do
    where(query, [object], object.object_type in ^types)
  end

  defp maybe_filter_query(query, ""), do: query

  defp maybe_filter_query(query, query_text) do
    like = "%#{escape_like(query_text)}%"

    where(query, [object], ilike(object.search_text, ^like))
  end

  defp optional_array_filter(_column, [], _param_index), do: {"", []}

  defp optional_array_filter(column, values, param_index) do
    {"AND #{column} = ANY($#{param_index}::text[])", [values]}
  end

  defp order_for_search(query, "") do
    order_by(query, [object],
      asc_nulls_last: object.apparent_magnitude,
      desc_nulls_last: object.radius_km,
      asc: object.name
    )
  end

  defp order_for_search(query, query_text) do
    prefix = "#{escape_like(query_text)}%"

    order_by(
      query,
      [object],
      desc: fragment("? ILIKE ?", object.name, ^prefix),
      desc: fragment("? ILIKE ?", object.key, ^prefix),
      asc_nulls_last: object.apparent_magnitude,
      desc_nulls_last: object.radius_km,
      asc: object.name
    )
  end

  defp external_links(%CatalogObject{} = object) do
    identifiers = object.external_ids || %{}
    facts = object.facts || %{}
    name = object.name || object.key

    [
      simbad_link(name, object),
      ned_link(name, object),
      jpl_small_body_link(identifiers),
      gaia_link(identifiers, facts)
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp simbad_link(name, object) do
    cond do
      object.source_type == "simbad_tap" or
          object.object_type in ["galaxy", "quasar", "active_galaxy", "black_hole"] ->
        %{
          provider: "SIMBAD",
          label: "SIMBAD object lookup",
          url: "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=#{URI.encode_www_form(name)}"
        }

      object.object_type in ["star", "star_cluster", "nebula"] ->
        %{
          provider: "SIMBAD",
          label: "SIMBAD object lookup",
          url: "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=#{URI.encode_www_form(name)}"
        }

      true ->
        nil
    end
  end

  defp ned_link(name, object) do
    if object.object_type in ["galaxy", "quasar", "active_galaxy", "black_hole"] do
      %{
        provider: "NED",
        label: "NASA/IPAC Extragalactic Database lookup",
        url: "https://ned.ipac.caltech.edu/byname?objname=#{URI.encode_www_form(name)}"
      }
    end
  end

  defp jpl_small_body_link(%{"jpl_spkid" => spkid}) when is_binary(spkid) do
    %{
      provider: "NASA/JPL SBDB",
      label: "Small-Body Database lookup",
      url: "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=#{URI.encode_www_form(spkid)}"
    }
  end

  defp jpl_small_body_link(_identifiers), do: nil

  defp gaia_link(%{"gaia_dr3_source_id" => source_id}, _facts) when is_binary(source_id) do
    %{
      provider: "ESA Gaia Archive",
      label: "Gaia DR3 source",
      url:
        "https://gea.esac.esa.int/archive/?ACTION=PUBLIC_DATALINK&ID=Gaia%20DR3%20#{URI.encode_www_form(source_id)}"
    }
  end

  defp gaia_link(_identifiers, %{"source_id" => source_id}) when is_binary(source_id) do
    gaia_link(%{"gaia_dr3_source_id" => source_id}, %{})
  end

  defp gaia_link(_identifiers, _facts), do: nil

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

  defp string_param(nil), do: ""
  defp string_param(value) when is_binary(value), do: String.trim(value)

  defp escape_like(value) do
    value
    |> String.trim()
    |> String.replace("\\", "\\\\")
    |> String.replace("%", "\\%")
    |> String.replace("_", "\\_")
  end
end
