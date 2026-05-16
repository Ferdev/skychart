defmodule StarsmapApi.Catalog.Importer do
  @moduledoc """
  Imports generated static catalog snapshots into the Phoenix catalog index.
  """

  alias StarsmapApi.Catalog

  @au_km 149_597_870.700
  @parsec_au 206_264.80624709636
  @light_year_km 9_460_730_472_580.8
  @solar_radius_km 695_700.0
  @earth_radius_km 6_371.0
  @obliquity_deg 23.4392911
  @report_sample_limit 20

  def import!(root_path \\ repo_root()) do
    rows = rows(root_path)
    report = import_report(rows)
    {count, _} = Catalog.upsert_objects(rows)

    %{
      imported_count: count,
      source_count: length(rows),
      groups: Enum.frequencies_by(rows, & &1.catalog_group),
      report: report
    }
  end

  def import_all(opts) do
    data_dir = Keyword.fetch!(opts, :data_dir)
    rows = data_dir |> catalog_files() |> Enum.flat_map(&rows_for_file/1)
    report = import_report(rows)
    {count, _} = Catalog.upsert_objects(rows)

    {:ok,
     %{
       total: count,
       counts: Enum.frequencies_by(rows, & &1.catalog_group),
       report: report
     }}
  end

  def rows(root_path \\ repo_root()) do
    root_path
    |> catalog_files()
    |> Enum.flat_map(&rows_for_file/1)
  end

  def attrs_for_entry!({type, entry}) do
    row_for_entry(type, entry, entry_source_meta(type, entry))
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

  def row_for_entry(:exoplanet_system, entry, source_meta) do
    position = projected_position(entry)
    planets = Map.get(entry, "planets", [])

    base_row(entry, source_meta, position, %{
      object_type: "star",
      catalog_group: "exoplanet_systems",
      source_type: "exoplanet_archive_system",
      position_model: "exoplanet_archive_coordinates",
      radius_km: solar_radius_to_km(entry["stellar_radius_solar"]),
      aliases: list(entry["aliases"]),
      external_ids: external_ids_from_aliases(entry["aliases"]),
      facts:
        take(entry, [
          "exoplanet_count",
          "stellar_radius_solar",
          "stellar_teff_k",
          "stellar_mass_solar",
          "spectral_type",
          "system_star_count",
          "system_planet_count",
          "system_moon_count",
          "why_interesting"
        ])
        |> Map.put("planets", planets),
      search_values: [
        entry["spectral_type"],
        entry["why_interesting"]
        | Enum.flat_map(planets, &[&1["name"], &1["discovery_method"]])
      ]
    })
  end

  def row_for_entry(:exoplanet, entry, source_meta) do
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: "planet",
      catalog_group: "exoplanets",
      source_type: "exoplanet_archive_planet",
      position_model: "exoplanet_archive_host_coordinates",
      parent_key: entry["parent_key"],
      radius_km: earth_radius_to_km(entry["radius_earth"]),
      aliases: list(entry["aliases"]),
      external_ids: reject_nil_values(%{"nasa_exoplanet_archive_name" => entry["name"]}),
      facts:
        take(entry, [
          "host_key",
          "host_name",
          "radius_earth",
          "mass_earth",
          "period_days",
          "semi_major_axis_au",
          "discovery_method",
          "discovery_year",
          "system_star_count",
          "system_planet_count",
          "system_moon_count",
          "why_interesting"
        ]),
      search_values: [
        entry["host_name"],
        entry["discovery_method"],
        entry["why_interesting"]
      ]
    })
  end

  def row_for_entry(:bright_star, entry, source_meta) do
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: "star",
      catalog_group: "bright_stars",
      source_type: "bright_star_catalog",
      position_model: "hipparcos_catalog_coordinates",
      radius_km: number(entry["radius_km"], 0.0),
      aliases: list(entry["aliases"]),
      external_ids: %{
        "hip" => prefixed_id("HIP", entry["hip"]),
        "hd" => prefixed_id("HD", entry["hd"])
      },
      facts:
        take(entry, [
          "parallax_mas",
          "hip",
          "hd",
          "bv_color_index",
          "stellar_radius_solar",
          "stellar_teff_k",
          "spectral_type",
          "stellar_radius_source",
          "why_interesting"
        ]),
      search_values: [entry["spectral_type"], entry["hip"], entry["hd"], entry["why_interesting"]]
    })
  end

  def row_for_entry(:deep_sky, entry, source_meta) do
    position = projected_position(entry)
    physical_diameter_ly = number(entry["physical_diameter_ly"]) || angular_diameter_ly(entry)

    base_row(entry, source_meta, position, %{
      object_type: entry["object_type"] || "unknown",
      catalog_group: "messier_deep_sky",
      source_type: "deep_sky_catalog",
      position_model: "deep_sky_catalog_coordinates",
      radius_km: deep_sky_radius_km(entry),
      aliases: list(entry["aliases"]),
      external_ids: %{
        "messier" => prefixed_id("M", entry["messier"]),
        "ngc" => prefixed_id("NGC", entry["ngc"]),
        "ic" => prefixed_id("IC", entry["ic"])
      },
      facts:
        take(entry, [
          "messier",
          "ngc",
          "ic",
          "distance_quality",
          "deep_sky_type",
          "deep_sky_type_label",
          "angular_size_arcmin",
          "constellation",
          "viewing_season",
          "common_name",
          "observing_equipment",
          "why_interesting",
          "physical_diameter_ly",
          "physical_minor_diameter_ly",
          "physical_size_note"
        ])
        |> Map.put("physical_diameter_ly", physical_diameter_ly),
      search_values: [
        entry["messier"],
        entry["ngc"],
        entry["ic"],
        entry["deep_sky_type"],
        entry["deep_sky_type_label"],
        entry["constellation"],
        entry["common_name"],
        entry["why_interesting"]
      ]
    })
  end

  def row_for_entry(:ngc_ic_deep_sky, entry, source_meta) do
    position = projected_position_optional(entry)
    physical_diameter_ly = number(entry["physical_diameter_ly"]) || angular_diameter_ly(entry)

    base_row(entry, source_meta, position, %{
      object_type: entry["object_type"] || "deep_sky_object",
      catalog_group: "ngc_ic_deep_sky",
      source_type: "openngc_ngc_ic_catalog",
      position_model: "openngc_j2000_coordinates",
      radius_km: deep_sky_radius_km(entry),
      aliases: list(entry["aliases"]),
      external_ids: %{
        "messier" => prefixed_id("M", entry["messier"]),
        "ngc" => prefixed_id("NGC", entry["ngc"]),
        "ic" => prefixed_id("IC", entry["ic"])
      },
      facts:
        (entry["facts"] || %{})
        |> Map.merge(
          take(entry, [
            "catalog_designation",
            "messier",
            "ngc",
            "ic",
            "distance_quality",
            "deep_sky_type",
            "deep_sky_type_label",
            "angular_size_arcmin",
            "constellation",
            "common_name",
            "physical_diameter_ly",
            "physical_minor_diameter_ly",
            "physical_size_note"
          ])
        )
        |> Map.put("physical_diameter_ly", physical_diameter_ly),
      search_values: [
        entry["catalog_designation"],
        entry["messier"],
        entry["ngc"],
        entry["ic"],
        entry["deep_sky_type"],
        entry["deep_sky_type_label"],
        entry["constellation"],
        fact(entry, "hubble_type"),
        fact(entry, "openngc_notes"),
        fact(entry, "ned_notes"),
        fact(entry, "why_interesting"),
        fact(entry, "identifiers"),
        fact(entry, "common_names")
      ]
    })
  end

  def row_for_entry(:small_body, entry, source_meta) do
    position = cartesian_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: entry["object_type"] || "small_body",
      catalog_group: "jpl_small_bodies",
      source_type: "jpl_sbdb_query",
      position_model: "jpl_sbdb_two_body_osculating_elements",
      parent_key: entry["parent_key"] || "sun",
      radius_km: number(entry["radius_km"], 0.0),
      aliases: list(entry["aliases"]),
      external_ids: entry["external_ids"] || %{},
      facts:
        (entry["facts"] || %{})
        |> Map.put_new("why_interesting", entry["why_interesting"])
        |> reject_nil_values()
        |> reject_empty_values(),
      search_values: [
        entry["why_interesting"],
        fact(entry, "full_name"),
        fact(entry, "orbit_class"),
        external_id(entry, "jpl_spkid"),
        external_id(entry, "primary_designation")
      ]
    })
  end

  def row_for_entry(:gaia_star, entry, source_meta) do
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: "star",
      catalog_group: "gaia_local_stars",
      source_type: "gaia_dr3",
      position_model: "gaia_dr3_epoch_2016_coordinates",
      radius_km: number(entry["radius_km"], 0.0),
      aliases: list(entry["aliases"]),
      external_ids: %{"gaia_dr3_source_id" => entry["source_id"]},
      facts:
        take(entry, [
          "source_id",
          "parallax_mas",
          "parallax_over_error",
          "bp_rp",
          "stellar_radius_solar",
          "stellar_teff_k",
          "stellar_radius_source",
          "pmra_mas_yr",
          "pmdec_mas_yr",
          "radial_velocity_km_s",
          "astrometric_params_solved",
          "why_interesting"
        ]),
      search_values: [
        entry["source_id"],
        entry["bp_rp"],
        entry["why_interesting"]
      ]
    })
  end

  def row_for_entry(:simbad_extragalactic, entry, source_meta) do
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: entry["object_type"] || "galaxy",
      catalog_group: "simbad_extragalactic",
      source_type: "simbad_tap",
      position_model: "simbad_redshift_distance_coordinates",
      radius_km: number(entry["radius_km"], 0.0),
      aliases: list(entry["aliases"]),
      external_ids: entry["external_ids"] || %{},
      facts:
        (entry["facts"] || %{})
        |> Map.put_new("why_interesting", entry["why_interesting"])
        |> reject_nil_values()
        |> reject_empty_values(),
      search_values: [
        entry["why_interesting"],
        fact(entry, "simbad_object_type"),
        fact(entry, "simbad_object_type_label"),
        fact(entry, "redshift")
      ]
    })
  end

  def row_for_entry(:simbad_compact_object, entry, source_meta) do
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: entry["object_type"] || "unknown",
      catalog_group: "simbad_compact_objects",
      source_type: "simbad_tap",
      position_model: entry["position_model"] || "simbad_compact_object_coordinates",
      radius_km: number(entry["radius_km"], 0.0),
      aliases: list(entry["aliases"]),
      external_ids: entry["external_ids"] || %{},
      facts:
        (entry["facts"] || %{})
        |> Map.put_new("why_interesting", entry["why_interesting"])
        |> reject_nil_values()
        |> reject_empty_values(),
      search_values: [
        entry["why_interesting"],
        fact(entry, "simbad_object_type"),
        fact(entry, "simbad_object_type_label"),
        fact(entry, "distance_quality")
      ]
    })
  end

  defp rows_for_file({:exoplanet_system = type, path}) do
    data = path |> File.read!() |> Jason.decode!()
    source_meta = source_meta(type, data, path)
    systems = entries(type, data)

    system_rows = Enum.map(systems, &row_for_entry(:exoplanet_system, &1, source_meta))

    planet_rows =
      systems
      |> Enum.flat_map(&exoplanet_planet_entries/1)
      |> Enum.map(&row_for_entry(:exoplanet, &1, source_meta))

    system_rows ++ planet_rows
  end

  defp rows_for_file({type, path}) do
    data = path |> File.read!() |> Jason.decode!()
    source_meta = source_meta(type, data, path)

    type
    |> entries(data)
    |> Enum.map(&row_for_entry(type, &1, source_meta))
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

  defp exoplanet_planet_entries(system) do
    host_key = system["key"]
    host_name = system["name"]

    system
    |> Map.get("planets", [])
    |> Enum.filter(&is_map/1)
    |> Enum.map(fn planet ->
      planet_name = planet["name"] |> to_string() |> String.trim()

      planet
      |> Map.merge(%{
        "key" => planet["key"] || "exoplanet-#{slug_key(planet_name)}",
        "name" => planet_name,
        "parent_key" => host_key,
        "host_key" => host_key,
        "host_name" => host_name,
        "aliases" => [planet_name, "#{host_name} planet"],
        "ra_deg" => system["ra_deg"],
        "dec_deg" => system["dec_deg"],
        "distance_pc" => system["distance_pc"],
        "system_star_count" => system["system_star_count"],
        "system_planet_count" => system["system_planet_count"],
        "system_moon_count" => system["system_moon_count"],
        "color" => planet["color"] || "#89d6ff",
        "why_interesting" => exoplanet_note(planet, host_name)
      })
    end)
    |> Enum.reject(fn planet -> planet["name"] == "" end)
  end

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
      {:simbad_compact_object, Path.join(catalog_dir, "simbad_compact_objects.json")}
    ]
    |> Enum.filter(fn {_type, path} -> File.exists?(path) end)
  end

  defp entry_source_meta(type, entry) do
    %{
      "catalog" => Atom.to_string(type),
      "source" => entry["source"],
      "provenance" => entry["source"]
    }
  end

  defp base_row(entry, source_meta, position, attrs) do
    aliases = attrs.aliases

    %{
      key: entry["key"] |> to_string() |> String.downcase(),
      name: entry["name"],
      object_type: attrs.object_type,
      catalog_group: attrs.catalog_group,
      source_type: attrs.source_type,
      position_model: attrs.position_model,
      parent_key: Map.get(attrs, :parent_key),
      color: entry["color"] || "#d9b86f",
      radius_km: attrs.radius_km,
      ra_deg: number(entry["ra_deg"]),
      dec_deg: number(entry["dec_deg"]),
      distance_pc: position.distance_pc,
      distance_ly: position.distance_ly,
      x_au: position.x_au,
      y_au: position.y_au,
      z_au: position.z_au,
      x_km: position.x_km,
      y_km: position.y_km,
      z_km: position.z_km,
      apparent_magnitude: number(entry["apparent_magnitude"]),
      absolute_magnitude: number(entry["absolute_magnitude"]),
      aliases: aliases,
      external_ids: reject_nil_values(attrs.external_ids),
      facts: attrs.facts |> reject_nil_values() |> reject_empty_values(),
      source: reject_nil_values(source_meta),
      search_text:
        search_text([
          entry["key"],
          entry["name"],
          attrs.object_type,
          attrs.catalog_group,
          aliases,
          attrs.search_values
        ])
    }
  end

  defp projected_position(entry) do
    ra_deg = number(entry["ra_deg"])
    dec_deg = number(entry["dec_deg"])
    distance_pc = number(entry["distance_pc"]) || distance_ly_to_pc(number(entry["distance_ly"]))

    if is_nil(ra_deg) or is_nil(dec_deg) or is_nil(distance_pc) do
      raise ArgumentError,
            "catalog entry #{inspect(entry["key"] || entry["name"])} is missing RA, Dec, or distance"
    end

    distance_au = distance_pc * @parsec_au
    ra_rad = radians(ra_deg)
    dec_rad = radians(dec_deg)

    equatorial_x_au = distance_au * :math.cos(dec_rad) * :math.cos(ra_rad)
    equatorial_y_au = distance_au * :math.cos(dec_rad) * :math.sin(ra_rad)
    equatorial_z_au = distance_au * :math.sin(dec_rad)

    obliquity_rad = radians(@obliquity_deg)
    x_au = equatorial_x_au
    y_au = equatorial_y_au * :math.cos(obliquity_rad) + equatorial_z_au * :math.sin(obliquity_rad)

    z_au =
      -equatorial_y_au * :math.sin(obliquity_rad) + equatorial_z_au * :math.cos(obliquity_rad)

    %{
      distance_pc: distance_pc,
      distance_ly: distance_au * @au_km / @light_year_km,
      x_au: x_au,
      y_au: y_au,
      z_au: z_au,
      x_km: x_au * @au_km,
      y_km: y_au * @au_km,
      z_km: z_au * @au_km
    }
  end

  defp projected_position_optional(entry) do
    projected_position(entry)
  rescue
    ArgumentError ->
      %{
        distance_pc: nil,
        distance_ly: nil,
        x_au: nil,
        y_au: nil,
        z_au: nil,
        x_km: nil,
        y_km: nil,
        z_km: nil
      }
  end

  defp cartesian_position(entry) do
    x_au = number(entry["x_au"])
    y_au = number(entry["y_au"])
    z_au = number(entry["z_au"], 0.0)

    if is_nil(x_au) or is_nil(y_au) do
      raise ArgumentError,
            "catalog entry #{inspect(entry["key"] || entry["name"])} is missing x_au or y_au"
    end

    %{
      distance_pc: nil,
      distance_ly: nil,
      x_au: x_au,
      y_au: y_au,
      z_au: z_au,
      x_km: number(entry["x_km"], x_au * @au_km),
      y_km: number(entry["y_km"], y_au * @au_km),
      z_km: number(entry["z_km"], z_au * @au_km)
    }
  end

  defp deep_sky_radius_km(entry) do
    case number(entry["physical_diameter_ly"]) || angular_diameter_ly(entry) do
      nil -> 0.0
      diameter_ly -> diameter_ly * @light_year_km / 2.0
    end
  end

  defp solar_radius_to_km(nil), do: 0.0
  defp solar_radius_to_km(value), do: number(value, 0.0) * @solar_radius_km

  defp earth_radius_to_km(nil), do: 0.0
  defp earth_radius_to_km(value), do: number(value, 0.0) * @earth_radius_km

  defp distance_ly_to_pc(nil), do: nil
  defp distance_ly_to_pc(value), do: value / 3.261563777

  defp radians(degrees), do: degrees * :math.pi() / 180.0

  defp search_text(values) do
    values
    |> List.flatten()
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.map(&String.downcase/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
    |> Enum.join(" ")
  end

  defp take(map, keys) do
    map
    |> Map.take(keys)
    |> reject_nil_values()
  end

  defp reject_nil_values(map) do
    map
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp reject_empty_values(map) do
    map
    |> Enum.reject(fn {_key, value} -> value == [] or value == %{} end)
    |> Map.new()
  end

  defp external_ids_from_aliases(aliases) do
    aliases
    |> list()
    |> Enum.reduce(%{}, fn alias, ids ->
      cond do
        String.match?(alias, ~r/^HD\s+\S+/i) -> Map.put_new(ids, "hd", alias)
        String.match?(alias, ~r/^HIP\s+\S+/i) -> Map.put_new(ids, "hip", alias)
        String.match?(alias, ~r/^TIC\s+\S+/i) -> Map.put_new(ids, "tic", alias)
        true -> ids
      end
    end)
  end

  defp prefixed_id(_prefix, nil), do: nil
  defp prefixed_id("M", value) when is_integer(value), do: "M#{value}"
  defp prefixed_id("M", value) when is_float(value), do: "M#{trunc(value)}"

  defp prefixed_id(prefix, value) when is_binary(value) do
    if String.match?(value, ~r/^#{Regex.escape(prefix)}\s+/i),
      do: value,
      else: "#{prefix} #{value}"
  end

  defp prefixed_id(prefix, value), do: "#{prefix} #{value}"

  defp angular_diameter_ly(entry) do
    distance_ly = number(entry["distance_ly"])

    with distance when is_number(distance) <- distance_ly,
         major_arcmin when is_number(major_arcmin) <-
           angular_major_arcmin(entry["angular_size_arcmin"]) do
      distance * 2.0 * :math.tan(radians(major_arcmin / 60.0) / 2.0)
    else
      _ -> nil
    end
  end

  defp angular_major_arcmin(value) when is_binary(value) do
    value
    |> String.replace("×", "x")
    |> String.split("x", parts: 2)
    |> List.first()
    |> number()
  end

  defp angular_major_arcmin(_value), do: nil

  defp number(value, fallback \\ nil)
  defp number(value, _fallback) when is_integer(value), do: value * 1.0
  defp number(value, _fallback) when is_float(value), do: value

  defp number(value, fallback) when is_binary(value) do
    case Float.parse(value) do
      {number, ""} -> number
      _ -> fallback
    end
  end

  defp number(_value, fallback), do: fallback

  defp list(value) when is_list(value), do: Enum.map(value, &to_string/1)
  defp list(_value), do: []

  defp fact(entry, key) do
    case entry["facts"] do
      facts when is_map(facts) -> facts[key]
      _ -> nil
    end
  end

  defp external_id(entry, key) do
    case entry["external_ids"] do
      ids when is_map(ids) -> ids[key]
      _ -> nil
    end
  end

  defp slug_key(value) do
    value
    |> to_string()
    |> String.downcase()
    |> String.replace("+", " plus ")
    |> String.replace(~r/[^a-z0-9]+/, "-")
    |> String.trim("-")
  end

  defp exoplanet_note(planet, host_name) do
    cond do
      number(planet["semi_major_axis_au"]) != nil and number(planet["semi_major_axis_au"]) < 0.05 ->
        "A confirmed close-in exoplanet orbiting #{host_name}."

      number(planet["radius_earth"]) != nil and number(planet["radius_earth"]) < 1.5 ->
        "A confirmed roughly Earth-sized exoplanet orbiting #{host_name}."

      true ->
        "A confirmed exoplanet from the NASA Exoplanet Archive orbiting #{host_name}."
    end
  end

  defp repo_root do
    __DIR__
    |> Path.join("../../../..")
    |> Path.expand()
  end
end
