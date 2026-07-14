defmodule StarsmapApi.Catalog.Importer do
  @moduledoc """
  Imports generated static catalog snapshots into the Phoenix catalog index.
  """

  alias StarsmapApi.Catalog.Importer.RowMapper
  alias StarsmapApi.Catalog.SnapshotStore

  @report_sample_limit 20

  def import!(root_path \\ repo_root(), opts \\ []) do
    rows = rows(root_path)
    report = import_report(rows)
    {count, _} = SnapshotStore.replace_snapshot_objects(rows)
    source_table_counts = source_table_counts(rows)

    result = %{
      imported_count: count,
      source_table_counts: source_table_counts,
      source_count: length(rows),
      groups: Enum.frequencies_by(rows, & &1.catalog_group),
      report: report
    }

    maybe_write_report(result, Keyword.get(opts, :report_path))
    result
  end

  def import_all(opts) do
    data_dir = Keyword.fetch!(opts, :data_dir)
    rows = data_dir |> catalog_files() |> Enum.flat_map(&rows_for_file/1)
    report = import_report(rows)
    {count, _} = SnapshotStore.replace_snapshot_objects(rows)
    source_table_counts = source_table_counts(rows)

    result = %{
      total: count,
      source_table_counts: source_table_counts,
      counts: Enum.frequencies_by(rows, & &1.catalog_group),
      report: report
    }

    maybe_write_report(result, Keyword.get(opts, :report_path))
    {:ok, result}
  end

  def rows(root_path \\ repo_root()) do
    root_path
    |> catalog_files()
    |> Enum.flat_map(&rows_for_file/1)
  end

  def attrs_for_entry!({type, entry}) do
    RowMapper.map(type, entry)
  end

  def import_report(rows) when is_list(rows) do
    global_duplicate_keys = duplicate_keys(rows)

    report = %{
      total_rows: length(rows),
      source_type_count: rows |> Enum.map(&source_type/1) |> Enum.uniq() |> length(),
      catalog_groups: frequencies_by(rows, :catalog_group),
      object_types: frequencies_by(rows, :object_type),
      source_types: source_type_reports(rows),
      duplicate_key_count: map_size(global_duplicate_keys),
      duplicate_keys: sample_keys(global_duplicate_keys),
      missing_key_count: Enum.count(rows, &blank?(Map.get(&1, :key))),
      missing_name_count: Enum.count(rows, &blank?(Map.get(&1, :name))),
      missing_source_type_count: Enum.count(rows, &blank?(Map.get(&1, :source_type))),
      missing_map_position_count: Enum.count(rows, &missing_map_position?/1),
      missing_ra_dec_count: Enum.count(rows, &missing_ra_dec?/1)
    }

    report
    |> Map.put(:valid?, valid_report?(report))
    |> Map.put(:warnings, validation_warnings(report))
  end

  def write_report!(report, path) when is_binary(path) and path != "" do
    path
    |> Path.dirname()
    |> File.mkdir_p!()

    File.write!(
      path,
      Jason.encode!(
        %{
          generated_at: DateTime.utc_now(),
          report: report
        },
        pretty: true
      ) <> "\n"
    )

    path
  end

  defp rows_for_file({:exoplanet_system = type, path}) do
    data = path |> File.read!() |> Jason.decode!()
    source_meta = source_meta(type, data, path)
    systems = entries(type, data)

    system_rows = Enum.map(systems, &RowMapper.map(:exoplanet_system, &1, source_meta))

    planet_rows =
      systems
      |> Enum.flat_map(&RowMapper.exoplanet_planet_entries/1)
      |> Enum.map(&RowMapper.map(:exoplanet, &1, source_meta))

    system_rows ++ planet_rows
  end

  defp rows_for_file({type, path}) do
    data = path |> File.read!() |> Jason.decode!()
    source_meta = source_meta(type, data, path)

    type
    |> entries(data)
    |> Enum.map(&RowMapper.map(type, &1, source_meta))
  end

  defp source_type_reports(rows) do
    rows
    |> Enum.group_by(&source_type/1)
    |> Enum.map(fn {source_type, source_rows} ->
      duplicate_keys = duplicate_keys(source_rows)

      {source_type,
       %{
         rows: length(source_rows),
         catalog_groups: frequencies_by(source_rows, :catalog_group),
         object_types: frequencies_by(source_rows, :object_type),
         source_catalogs: source_catalog_counts(source_rows),
         duplicate_key_count: map_size(duplicate_keys),
         duplicate_keys: sample_keys(duplicate_keys),
         missing_key_count: Enum.count(source_rows, &blank?(Map.get(&1, :key))),
         missing_name_count: Enum.count(source_rows, &blank?(Map.get(&1, :name))),
         missing_map_position_count: Enum.count(source_rows, &missing_map_position?/1),
         missing_ra_dec_count: Enum.count(source_rows, &missing_ra_dec?/1)
       }}
    end)
    |> Enum.sort_by(fn {source_type, _report} -> source_type end)
    |> Map.new()
  end

  defp frequencies_by(rows, field) do
    rows
    |> Enum.map(fn row -> Map.get(row, field) end)
    |> Enum.map(&empty_to_unknown/1)
    |> Enum.frequencies()
  end

  defp source_catalog_counts(rows) do
    rows
    |> Enum.map(fn row ->
      case Map.get(row, :source) do
        %{} = source -> source["catalog"]
        _ -> nil
      end
    end)
    |> Enum.map(&empty_to_unknown/1)
    |> Enum.frequencies()
  end

  defp maybe_write_report(_result, nil), do: :ok
  defp maybe_write_report(_result, ""), do: :ok

  defp maybe_write_report(result, path) do
    write_report!(result, path)
    :ok
  end

  defp duplicate_keys(rows) do
    rows
    |> Enum.map(&Map.get(&1, :key))
    |> Enum.reject(&blank?/1)
    |> Enum.frequencies()
    |> Enum.filter(fn {_key, count} -> count > 1 end)
    |> Map.new()
  end

  defp sample_keys(duplicate_keys) do
    duplicate_keys
    |> Map.keys()
    |> Enum.sort()
    |> Enum.take(@report_sample_limit)
  end

  defp source_type(row), do: row |> Map.get(:source_type) |> empty_to_unknown()

  defp missing_map_position?(row), do: is_nil(Map.get(row, :x_au)) or is_nil(Map.get(row, :y_au))

  defp missing_ra_dec?(row), do: is_nil(Map.get(row, :ra_deg)) or is_nil(Map.get(row, :dec_deg))

  defp valid_report?(report) do
    report.duplicate_key_count == 0 and
      report.missing_key_count == 0 and
      report.missing_name_count == 0 and
      report.missing_source_type_count == 0 and
      report.missing_map_position_count == 0
  end

  defp validation_warnings(report) do
    [
      warning(report.duplicate_key_count, "duplicate catalog keys"),
      warning(report.missing_key_count, "rows without stable keys"),
      warning(report.missing_name_count, "rows without names"),
      warning(report.missing_source_type_count, "rows without source types"),
      warning(report.missing_map_position_count, "rows without projected map coordinates"),
      warning(report.missing_ra_dec_count, "rows without RA/Dec coordinates")
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp warning(0, _label), do: nil
  defp warning(count, label), do: "#{count} #{label}"

  defp blank?(value), do: value in [nil, ""]

  defp empty_to_unknown(value) when value in [nil, ""], do: "unknown"
  defp empty_to_unknown(value), do: to_string(value)

  defp entries(:exoplanet_system, data), do: Map.fetch!(data, "systems")
  defp entries(:bright_star, data), do: Map.fetch!(data, "stars")
  defp entries(:deep_sky, data), do: Map.fetch!(data, "objects")
  defp entries(:ngc_ic_deep_sky, data), do: Map.fetch!(data, "objects")
  defp entries(:small_body, data), do: Map.fetch!(data, "objects")
  defp entries(:gaia_star, data), do: Map.fetch!(data, "stars")
  defp entries(:simbad_extragalactic, data), do: Map.fetch!(data, "objects")
  defp entries(:simbad_compact_object, data), do: Map.fetch!(data, "objects")
  defp entries(:bass_dr2_black_hole, data), do: Map.fetch!(data, "objects")
  defp entries(:curated_extragalactic_survey, data), do: Map.fetch!(data, "objects")

  defp source_meta(type, data, path) do
    %{
      "catalog" => Atom.to_string(type),
      "path" => Path.relative_to(path, repo_root()),
      "generated_at_utc" => data["generated_at_utc"],
      "schema_version" => data["schema_version"],
      "source" => data["source"] || data["sources"] || data["selection"],
      "provenance" => data["source"] || data["sources"]
    }
  end

  defp catalog_files(root_path) do
    catalog_dir =
      if File.exists?(Path.join(root_path, "deep_sky_catalog.json")) do
        root_path
      else
        Path.join(root_path, "data/catalogs")
      end

    [
      {:exoplanet_system, Path.join(catalog_dir, "exoplanet_systems.json")},
      {:bright_star, Path.join(catalog_dir, "bright_stars.json")},
      {:deep_sky, Path.join(catalog_dir, "deep_sky_catalog.json")},
      {:ngc_ic_deep_sky, Path.join(catalog_dir, "ngc_ic_deep_sky.json")},
      {:small_body, Path.join(catalog_dir, "small_bodies.json")},
      {:gaia_star, Path.join(catalog_dir, "gaia_local_stars.json")},
      {:simbad_extragalactic, Path.join(catalog_dir, "simbad_extragalactic.json")},
      {:simbad_compact_object, Path.join(catalog_dir, "simbad_compact_objects.json")},
      {:bass_dr2_black_hole, Path.join(catalog_dir, "bass_dr2_black_holes.json")},
      {:curated_extragalactic_survey, Path.join(catalog_dir, "curated_extragalactic_survey.json")}
    ]
    |> Enum.filter(fn {_type, path} -> File.exists?(path) end)
  end

  defp source_table_counts(rows) do
    rows
    |> Enum.map(&source_table_for_row/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.frequencies()
  end

  defp source_table_for_row(%{source_type: "gaia_dr3"}), do: "catalog_gaia_stars"
  defp source_table_for_row(%{source_type: "bright_star_catalog"}), do: "catalog_stellar_stars"
  defp source_table_for_row(%{source_type: "jpl_sbdb_query"}), do: "catalog_small_bodies"
  defp source_table_for_row(%{source_type: "jpl_sb_sat"}), do: "catalog_small_bodies"
  defp source_table_for_row(%{source_type: "deep_sky_catalog"}), do: "catalog_deep_sky_objects"

  defp source_table_for_row(%{source_type: "openngc_ngc_ic_catalog"}),
    do: "catalog_deep_sky_objects"

  defp source_table_for_row(%{source_type: "exoplanet_archive_system"}),
    do: "catalog_exoplanet_objects"

  defp source_table_for_row(%{source_type: "exoplanet_archive_planet"}),
    do: "catalog_exoplanet_objects"

  defp source_table_for_row(%{source_type: "simbad_tap"}), do: "catalog_simbad_objects"

  defp source_table_for_row(%{source_type: "curated_extragalactic_survey"}),
    do: "catalog_simbad_objects"

  defp source_table_for_row(%{source_type: "bass_dr2_black_hole_mass"}),
    do: "catalog_bass_dr2_objects"

  defp source_table_for_row(_row), do: nil

  defp repo_root do
    __DIR__
    |> Path.join("../../../..")
    |> Path.expand()
  end
end
