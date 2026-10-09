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
    rows = rows(data_dir)
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
    |> with_exoplanet_candidates(Path.join(catalog_dir(root_path), "exoplanet_candidates.json"))
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

  # The candidates come last, because a candidate can belong to a star that
  # another file gives. A confirmed-planet host with one of the identifiers of
  # the star keeps its one row, and the candidates take its coordinates. A
  # Gaia local star with one of the identifiers gives its position to the new
  # star row, so that the two records of one star are at one place. The
  # confirmed host or the Gaia star gets the short list of the candidates.
  defp with_exoplanet_candidates(rows, path) do
    if File.exists?(path) do
      type = :exoplanet_candidate_system
      data = path |> File.read!() |> Jason.decode!()
      file_meta = source_meta(type, data, path)
      sources = data["sources"] || %{}
      confirmed_hosts = confirmed_hosts_by_identifier(rows)
      gaia_stars = gaia_stars_by_identifier(rows)

      {hosts, candidates, summaries} =
        data
        |> Map.fetch!("systems")
        |> Enum.reduce({[], [], %{}}, fn system, {hosts, candidates, summaries} ->
          source_meta = candidate_source_meta(file_meta, sources[system["catalog"]])
          identifiers = host_identifiers(system)

          case Enum.find_value(identifiers, &Map.get(confirmed_hosts, &1)) do
            nil ->
              gaia_star = Enum.find_value(identifiers, &Map.get(gaia_stars, &1))
              system = at_gaia_star(system, gaia_star)
              host = RowMapper.map(type, system, source_meta)

              {[host | hosts], [candidates_of(system, system, source_meta) | candidates],
               put_summary(summaries, gaia_star, system)}

            confirmed ->
              case without_confirmed_planets(system, confirmed) do
                %{"candidates" => []} ->
                  {hosts, candidates, summaries}

                system ->
                  host = host_entry(confirmed)

                  {hosts, [candidates_of(system, host, source_meta) | candidates],
                   put_summary(summaries, confirmed, system)}
              end
          end
        end)

      Enum.map(rows, &put_candidate_summary(&1, summaries)) ++
        Enum.reverse(hosts) ++ (candidates |> Enum.reverse() |> Enum.concat())
    else
      rows
    end
  end

  defp put_summary(summaries, nil, _system), do: summaries

  defp put_summary(summaries, row, system) do
    summary = Enum.map(system["candidates"], &RowMapper.exoplanet_candidate_summary/1)
    Map.update(summaries, row.key, summary, &(&1 ++ summary))
  end

  defp candidates_of(system, host, source_meta) do
    system
    |> RowMapper.exoplanet_candidate_entries(host)
    |> Enum.map(&RowMapper.map(:exoplanet_candidate, &1, source_meta))
  end

  # A candidate table can keep a candidate after the archive confirms it as a
  # planet. A candidate with the period of a confirmed planet of its host is
  # that planet, and the confirmed catalog has it.
  @same_planet_period_tolerance 0.001

  defp without_confirmed_planets(system, confirmed) do
    periods =
      for %{"period_days" => period} when is_number(period) <- confirmed.facts["planets"] || [],
          do: period

    Map.update!(system, "candidates", fn candidates ->
      Enum.reject(candidates, fn candidate ->
        period = candidate["period_days"]

        is_number(period) and
          Enum.any?(periods, &(abs(period - &1) <= &1 * @same_planet_period_tolerance))
      end)
    end)
  end

  # Each row keeps the source block of its own catalog, not the blocks of all catalogs.
  defp candidate_source_meta(file_meta, nil), do: file_meta

  defp candidate_source_meta(file_meta, source),
    do: Map.merge(file_meta, %{"source" => source, "provenance" => source})

  # A snapshot of schema version 1 gives the TIC number only.
  defp host_identifiers(%{"host_identifiers" => identifiers}) when is_list(identifiers),
    do: identifiers

  defp host_identifiers(%{"tic_id" => tic_id}) when is_binary(tic_id), do: ["TIC #{tic_id}"]
  defp host_identifiers(_system), do: []

  defp confirmed_hosts_by_identifier(rows) do
    for %{source_type: "exoplanet_archive_system"} = row <- rows,
        identifier <- [row.name | row.aliases],
        into: %{},
        do: {identifier, row}
  end

  defp gaia_stars_by_identifier(rows) do
    for %{source_type: "gaia_dr3"} = row <- rows,
        identifier <- row.aliases,
        String.starts_with?(identifier, ["TIC ", "Gaia DR3 "]),
        into: %{},
        do: {identifier, row}
  end

  @gaia_position_facts ~w(
    parallax_mas parallax_over_error pmra_mas_yr pmdec_mas_yr source_epoch position_epoch
    catalog_ra_deg catalog_dec_deg proper_motion_note
  )

  defp at_gaia_star(system, nil), do: system

  defp at_gaia_star(system, star) do
    system
    |> Map.merge(host_entry(star) |> Map.take(["ra_deg", "dec_deg", "distance_pc"]))
    |> Map.merge(Map.take(star.facts, @gaia_position_facts))
    |> Map.merge(%{"position_model" => star.position_model, "position_source_key" => star.key})
  end

  defp host_entry(row) do
    %{
      "key" => row.key,
      "name" => row.name,
      "ra_deg" => row.ra_deg,
      "dec_deg" => row.dec_deg,
      "distance_pc" => row.distance_pc
    }
  end

  defp put_candidate_summary(%{key: key, facts: facts} = row, summaries)
       when is_map_key(summaries, key) do
    candidates = Map.fetch!(summaries, key)

    %{
      row
      | facts:
          facts
          |> Map.put("candidates", candidates)
          |> Map.put("candidate_count", length(candidates))
    }
  end

  defp put_candidate_summary(row, _summaries), do: row

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

  defp catalog_dir(root_path) do
    if File.exists?(Path.join(root_path, "deep_sky_catalog.json")) do
      root_path
    else
      Path.join(root_path, "data/catalogs")
    end
  end

  defp catalog_files(root_path) do
    catalog_dir = catalog_dir(root_path)

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

  defp source_table_for_row(%{catalog_group: group})
       when group in ["exoplanet_candidate_hosts", "exoplanet_candidates"],
       do: "catalog_exoplanet_objects"

  defp source_table_for_row(_row), do: nil

  defp repo_root do
    __DIR__
    |> Path.join("../../../..")
    |> Path.expand()
  end
end
