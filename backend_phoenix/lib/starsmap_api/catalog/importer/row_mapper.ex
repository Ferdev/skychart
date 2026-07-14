defmodule StarsmapApi.Catalog.Importer.RowMapper do
  @moduledoc """
  Converts each source-specific catalog record into the normalized import row.

  Coordinate projection, proper-motion propagation, source semantics, and the
  per-source field mapping live together so adding a source has one obvious home.
  """
  @au_km 149_597_870.700
  @parsec_au 206_264.80624709636
  @light_year_km 9_460_730_472_580.8
  @solar_radius_km 695_700.0
  @earth_radius_km 6_371.0
  @obliquity_deg 23.4392911
  @gaia_dr3_epoch 2016.0
  @hipparcos_epoch 1991.25
  @default_stellar_position_epoch 2026.0

  def map(type, entry) do
    map(type, entry, entry_source_meta(type, entry))
  end

  def map(:exoplanet_system, entry, source_meta) do
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

  def map(:exoplanet, entry, source_meta) do
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

  def map(:bright_star, entry, source_meta) do
    entry = propagate_stellar_position(entry, @hipparcos_epoch)
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: "star",
      catalog_group: "bright_stars",
      source_type: "bright_star_catalog",
      position_model: stellar_position_model("hipparcos", entry),
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
          "source_epoch",
          "position_epoch",
          "catalog_ra_deg",
          "catalog_dec_deg",
          "pmra_mas_yr",
          "pmdec_mas_yr",
          "proper_motion_note",
          "why_interesting"
        ]),
      search_values: [entry["spectral_type"], entry["hip"], entry["hd"], entry["why_interesting"]]
    })
  end

  def map(:deep_sky, entry, source_meta) do
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

  def map(:ngc_ic_deep_sky, entry, source_meta) do
    entry = sanitize_openngc_distance(entry)
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

  def map(:small_body, entry, source_meta) do
    position = cartesian_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: entry["object_type"] || "small_body",
      catalog_group: "jpl_small_bodies",
      source_type: entry["source_type"] || "jpl_sbdb_query",
      position_model: entry["position_model"] || "jpl_sbdb_two_body_osculating_elements",
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

  def map(:gaia_star, entry, source_meta) do
    entry = propagate_stellar_position(entry, @gaia_dr3_epoch)
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: "star",
      catalog_group: "gaia_local_stars",
      source_type: "gaia_dr3",
      position_model: stellar_position_model("gaia_dr3", entry),
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
          "source_epoch",
          "position_epoch",
          "catalog_ra_deg",
          "catalog_dec_deg",
          "proper_motion_note",
          "why_interesting"
        ]),
      search_values: [
        entry["source_id"],
        entry["bp_rp"],
        entry["why_interesting"]
      ]
    })
  end

  def map(:simbad_extragalactic, entry, source_meta) do
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

  def map(:simbad_compact_object, entry, source_meta) do
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

  def map(:bass_dr2_black_hole, entry, source_meta) do
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: "black_hole",
      catalog_group: "bass_dr2_black_holes",
      source_type: "bass_dr2_black_hole_mass",
      position_model: entry["position_model"] || "bass_dr2_catalog_distance_coordinates",
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
        fact(entry, "black_hole_mass_log10_solar"),
        fact(entry, "black_hole_mass_method"),
        fact(entry, "redshift"),
        fact(entry, "bass_id")
      ]
    })
  end

  def map(:curated_extragalactic_survey, entry, source_meta) do
    position = projected_position(entry)

    base_row(entry, source_meta, position, %{
      object_type: entry["object_type"] || "galaxy",
      catalog_group: "curated_extragalactic_survey",
      source_type: entry["source_type"] || "curated_extragalactic_survey",
      position_model: entry["position_model"] || "survey_ra_dec_distance_coordinates",
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
        fact(entry, "source_catalog"),
        fact(entry, "survey_class"),
        fact(entry, "redshift")
      ]
    })
  end

  defp sanitize_openngc_distance(entry) do
    quality = entry["distance_quality"]
    galaxy? = entry["object_type"] == "galaxy"

    valid? =
      (galaxy? and quality == "hubble_flow_redshift_approximation") or
        (not galaxy? and quality == "parallax")

    if valid? do
      entry
    else
      entry
      |> Map.drop(["distance_pc", "distance_ly", "x_au", "y_au", "z_au", "x_km", "y_km", "z_km"])
      |> Map.put("distance_quality", "not_available")
    end
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

  defp propagate_stellar_position(entry, source_epoch) do
    target_epoch = stellar_position_epoch()
    ra_deg = number(entry["ra_deg"])
    dec_deg = number(entry["dec_deg"])
    pmra_mas_yr = number(entry["pmra_mas_yr"] || entry["pmra"])
    pmdec_mas_yr = number(entry["pmdec_mas_yr"] || entry["pmdec"])

    base =
      entry
      |> Map.put_new("source_epoch", source_epoch)
      |> Map.put_new("catalog_ra_deg", ra_deg)
      |> Map.put_new("catalog_dec_deg", dec_deg)

    cond do
      is_nil(ra_deg) or is_nil(dec_deg) ->
        base

      is_nil(pmra_mas_yr) or is_nil(pmdec_mas_yr) ->
        base
        |> Map.put("position_epoch", source_epoch)
        |> Map.put(
          "proper_motion_note",
          "No complete proper-motion vector was available; position remains at the source catalog epoch."
        )

      true ->
        years = target_epoch - source_epoch
        dec_rad = radians(dec_deg)
        cos_dec = max(:math.cos(dec_rad), 1.0e-8)
        propagated_ra = normalize_degrees(ra_deg + pmra_mas_yr * years / (3_600_000.0 * cos_dec))
        propagated_dec = max(-90.0, min(90.0, dec_deg + pmdec_mas_yr * years / 3_600_000.0))

        base
        |> Map.put("ra_deg", propagated_ra)
        |> Map.put("dec_deg", propagated_dec)
        |> Map.put("pmra_mas_yr", pmra_mas_yr)
        |> Map.put("pmdec_mas_yr", pmdec_mas_yr)
        |> Map.put("position_epoch", target_epoch)
        |> Map.put(
          "proper_motion_note",
          "RA/Dec propagated from source epoch using catalog proper motion."
        )
    end
  end

  defp stellar_position_model(prefix, entry) do
    epoch = number(entry["position_epoch"]) || number(entry["source_epoch"])
    epoch_label = epoch |> :erlang.float_to_binary(decimals: 2) |> String.replace(".", "_")

    if to_string(entry["proper_motion_note"]) =~ "propagated" do
      "#{prefix}_epoch_#{epoch_label}_proper_motion_coordinates"
    else
      "#{prefix}_epoch_#{epoch_label}_catalog_coordinates"
    end
  end

  defp stellar_position_epoch do
    case System.get_env("CATALOG_STELLAR_POSITION_EPOCH") do
      value when is_binary(value) ->
        number(value, @default_stellar_position_epoch)

      _ ->
        @default_stellar_position_epoch
    end
  end

  defp normalize_degrees(value) do
    normalized = value - :math.floor(value / 360.0) * 360.0
    if normalized < 0.0, do: normalized + 360.0, else: normalized
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

  def exoplanet_planet_entries(system) do
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
end
