defmodule StarsmapApi.Catalog.SnapshotStore do
  @moduledoc """
  Reconciles immutable catalog snapshots into source-specific tables and owns
  the summary counts derived from those tables.
  """

  import Ecto.Query

  alias StarsmapApi.Catalog.CatalogSourceObject
  alias StarsmapApi.Catalog.PointTileCache
  alias StarsmapApi.Repo

  @summary_timeout 120_000
  @snapshot_replace_timeout 300_000
  @source_table_replace_fields [
    :name,
    :source_type,
    :catalog_group,
    :object_type,
    :position_model,
    :parent_key,
    :color,
    :radius_km,
    :source_identifier,
    :source_epoch,
    :position_epoch,
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
    :pmra_mas_yr,
    :pmdec_mas_yr,
    :radial_velocity_km_s,
    :source_payload,
    :projected_payload,
    :source,
    :updated_at
  ]

  def upsert_objects(objects) when is_list(objects) do
    counts = upsert_source_objects(objects)
    PointTileCache.clear()
    {Enum.sum(Map.values(counts)), nil}
  end

  def replace_snapshot_objects(objects) when is_list(objects) do
    transaction = fn ->
      reconcile_snapshot_groups(objects)
      upsert_source_objects(objects)
    end

    case Repo.transaction(transaction, timeout: @snapshot_replace_timeout) do
      {:ok, counts} ->
        PointTileCache.clear()
        {Enum.sum(Map.values(counts)), nil}

      {:error, reason} ->
        raise "catalog snapshot replacement failed: #{inspect(reason)}"
    end
  end

  def upsert_source_objects(objects) when is_list(objects) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    objects
    |> Enum.group_by(&source_table_for/1)
    |> Enum.reject(fn {table, rows} -> is_nil(table) or rows == [] end)
    |> Enum.reduce(%{}, fn {table, source_rows}, counts ->
      rows =
        Enum.map(source_rows, fn object ->
          facts = Map.get(object, :facts) || %{}
          external_ids = Map.get(object, :external_ids) || %{}

          %{
            # insert_all against a table name has no schema type info, so the
            # uuid column needs the 16-byte binary form, not the string form.
            id: Ecto.UUID.bingenerate(),
            key: Map.fetch!(object, :key),
            catalog_object_key: Map.fetch!(object, :key),
            name: Map.fetch!(object, :name),
            source_type: Map.fetch!(object, :source_type),
            catalog_group: Map.fetch!(object, :catalog_group),
            object_type: Map.fetch!(object, :object_type),
            position_model: Map.fetch!(object, :position_model),
            parent_key: Map.get(object, :parent_key),
            color: Map.get(object, :color),
            radius_km: Map.get(object, :radius_km),
            source_identifier: source_identifier(object, external_ids, facts),
            source_epoch: number_fact(facts, "source_epoch"),
            position_epoch: number_fact(facts, "position_epoch"),
            ra_deg: Map.get(object, :ra_deg),
            dec_deg: Map.get(object, :dec_deg),
            distance_pc: Map.get(object, :distance_pc),
            distance_ly: Map.get(object, :distance_ly),
            x_au: Map.get(object, :x_au),
            y_au: Map.get(object, :y_au),
            z_au: Map.get(object, :z_au),
            x_km: Map.get(object, :x_km),
            y_km: Map.get(object, :y_km),
            z_km: Map.get(object, :z_km),
            apparent_magnitude: Map.get(object, :apparent_magnitude),
            absolute_magnitude: Map.get(object, :absolute_magnitude),
            search_text: Map.get(object, :search_text) || "",
            aliases: Map.get(object, :aliases) || [],
            external_ids: external_ids,
            facts: facts,
            pmra_mas_yr: number_fact(facts, "pmra_mas_yr"),
            pmdec_mas_yr: number_fact(facts, "pmdec_mas_yr"),
            radial_velocity_km_s: number_fact(facts, "radial_velocity_km_s"),
            source_payload: facts,
            projected_payload: %{
              "distance_pc" => Map.get(object, :distance_pc),
              "distance_ly" => Map.get(object, :distance_ly),
              "x_au" => Map.get(object, :x_au),
              "y_au" => Map.get(object, :y_au),
              "z_au" => Map.get(object, :z_au),
              "x_km" => Map.get(object, :x_km),
              "y_km" => Map.get(object, :y_km),
              "z_km" => Map.get(object, :z_km)
            },
            source: Map.get(object, :source) || %{},
            inserted_at: now,
            updated_at: now
          }
        end)

      count =
        rows
        |> Enum.chunk_every(source_insert_chunk_size(rows))
        |> Enum.reduce(0, fn chunk, inserted ->
          {chunk_count, _} =
            Repo.insert_all(table, chunk,
              on_conflict: {:replace, @source_table_replace_fields},
              conflict_target: :key
            )

          inserted + chunk_count
        end)

      Map.put(counts, table, count)
    end)
  end

  # The postgresql protocol caps one statement at 65_535 bind parameters, so
  # whole-catalog inserts must be chunked by row width.
  defp source_insert_chunk_size([row | _rest]), do: max(div(65_000, max(map_size(row), 1)), 1)
  defp source_insert_chunk_size([]), do: 1

  defp reconcile_snapshot_groups(objects) do
    objects
    |> Enum.group_by(fn object ->
      {source_table_for(object), Map.fetch!(object, :catalog_group)}
    end)
    |> Enum.reject(fn {{table, _group}, rows} -> is_nil(table) or rows == [] end)
    |> Enum.each(fn {{table, group}, rows} ->
      keys = Enum.map(rows, &Map.fetch!(&1, :key))

      # `table` comes only from the closed source_table_for/1 mapping above;
      # group and keys remain query parameters.
      Repo.query!(
        "DELETE FROM #{table} WHERE catalog_group = $1 AND NOT (key = ANY($2::text[]))",
        [group, keys]
      )
    end)
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
      FROM catalog_source_objects
      UNION ALL
      SELECT 'catalog_group'::text AS bucket, catalog_group AS name, COUNT(*)::bigint AS total
      FROM catalog_source_objects
      GROUP BY catalog_group
      UNION ALL
      SELECT 'object_type'::text AS bucket, object_type AS name, COUNT(*)::bigint AS total
      FROM catalog_source_objects
      GROUP BY object_type
      UNION ALL
      SELECT 'source_type'::text AS bucket, source_type AS name, COUNT(*)::bigint AS total
      FROM catalog_source_objects
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
      CatalogSourceObject
      |> group_by([object], object.catalog_group)
      |> select([object], {object.catalog_group, count(object.id)})
      |> Repo.all(timeout: @summary_timeout)
      |> Map.new()

    type_counts =
      CatalogSourceObject
      |> group_by([object], object.object_type)
      |> select([object], {object.object_type, count(object.id)})
      |> Repo.all(timeout: @summary_timeout)
      |> Map.new()

    source_counts =
      CatalogSourceObject
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

  defp source_table_for(%{source_type: "gaia_dr3"}), do: "catalog_gaia_stars"
  defp source_table_for(%{source_type: "bright_star_catalog"}), do: "catalog_stellar_stars"
  defp source_table_for(%{source_type: "jpl_sbdb_query"}), do: "catalog_small_bodies"
  defp source_table_for(%{source_type: "jpl_sb_sat"}), do: "catalog_small_bodies"
  defp source_table_for(%{source_type: "deep_sky_catalog"}), do: "catalog_deep_sky_objects"
  defp source_table_for(%{source_type: "openngc_ngc_ic_catalog"}), do: "catalog_deep_sky_objects"

  defp source_table_for(%{source_type: "exoplanet_archive_system"}),
    do: "catalog_exoplanet_objects"

  defp source_table_for(%{source_type: "exoplanet_archive_planet"}),
    do: "catalog_exoplanet_objects"

  defp source_table_for(%{source_type: "simbad_tap"}), do: "catalog_simbad_objects"

  defp source_table_for(%{source_type: "curated_extragalactic_survey"}),
    do: "catalog_simbad_objects"

  defp source_table_for(%{source_type: "bass_dr2_black_hole_mass"}),
    do: "catalog_bass_dr2_objects"

  defp source_table_for(%{catalog_group: group})
       when group in ["messier_deep_sky", "ngc_ic_deep_sky"],
       do: "catalog_deep_sky_objects"

  defp source_table_for(%{catalog_group: group})
       when group in ["nearby_exoplanet_systems", "exoplanet_systems", "exoplanets"],
       do: "catalog_exoplanet_objects"

  defp source_table_for(%{catalog_group: "bass_dr2_black_holes"}),
    do: "catalog_bass_dr2_objects"

  defp source_table_for(%{catalog_group: group})
       when group in [
              "simbad_extragalactic",
              "simbad_compact_objects",
              "curated_extragalactic_survey"
            ],
       do: "catalog_simbad_objects"

  defp source_table_for(_object), do: nil

  defp source_identifier(_object, external_ids, facts) do
    external_ids["gaia_dr3_source_id"] ||
      external_ids["jpl_spkid"] ||
      external_ids["hip"] ||
      external_ids["hd"] ||
      external_ids["simbad_oid"] ||
      external_ids["bass_dr2_id"] ||
      facts["source_id"] ||
      facts["full_name"]
  end

  defp number_fact(facts, key) do
    case facts[key] do
      value when is_integer(value) -> value * 1.0
      value when is_float(value) -> value
      _ -> nil
    end
  end
end
