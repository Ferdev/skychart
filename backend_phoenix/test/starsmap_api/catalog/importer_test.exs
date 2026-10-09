defmodule StarsmapApi.Catalog.ImporterTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Catalog.CatalogSourceObject
  alias StarsmapApi.Catalog.Importer
  alias StarsmapApi.Catalog.Importer.RowMapper
  alias StarsmapApi.Catalog.PublicObjects
  alias StarsmapApi.Catalog.SnapshotStore

  test "maps deep-sky entries with provenance, IDs, coordinates, and search text" do
    attrs =
      Importer.attrs_for_entry!(
        {:deep_sky,
         %{
           "key" => "M1",
           "name" => "M1 Crab Nebula",
           "object_type" => "nebula",
           "ra_deg" => 83.625,
           "dec_deg" => 22.01666667,
           "distance_ly" => 6300.0,
           "aliases" => ["M1", "Messier 1", "NGC 1952", "Crab Nebula"],
           "messier" => 1,
           "ngc" => "1952",
           "common_name" => "Crab Nebula",
           "constellation" => "Tau",
           "deep_sky_type" => "Sn",
           "deep_sky_type_label" => "Supernova remnant",
           "angular_size_arcmin" => "6x4",
           "source" => "AstroPixels Messier catalog table"
         }}
      )

    assert attrs.key == "m1"
    assert attrs.catalog_group == "messier_deep_sky"
    assert attrs.source_type == "deep_sky_catalog"
    assert attrs.position_model == "deep_sky_catalog_coordinates"
    assert attrs.external_ids == %{"messier" => "M1", "ngc" => "NGC 1952"}
    assert attrs.facts["common_name"] == "Crab Nebula"
    assert attrs.facts["physical_diameter_ly"] > 10.0
    assert attrs.source["provenance"] == "AstroPixels Messier catalog table"
    assert is_float(attrs.x_au)
    assert attrs.search_text =~ "crab nebula"
    assert attrs.search_text =~ "ngc 1952"
    assert attrs.search_text =~ "supernova remnant"
  end

  test "maps exoplanet system entries with planet names in search text" do
    attrs =
      Importer.attrs_for_entry!(
        {:exoplanet_system,
         %{
           "key" => "exosys-11-com",
           "name" => "11 Com",
           "ra_deg" => 185.1787793,
           "dec_deg" => 17.7932516,
           "distance_pc" => 93.1846,
           "aliases" => ["HD 107383", "HIP 60202", "TIC 72437047", "11 Com b"],
           "spectral_type" => "G8 III",
           "stellar_radius_solar" => 13.76,
           "planets" => [
             %{
               "name" => "11 Com b",
               "discovery_method" => "Radial Velocity",
               "period_days" => 323.21
             }
           ]
         }}
      )

    assert attrs.key == "exosys-11-com"
    assert attrs.catalog_group == "exoplanet_systems"

    assert attrs.external_ids == %{
             "hd" => "HD 107383",
             "hip" => "HIP 60202",
             "tic" => "TIC 72437047"
           }

    assert attrs.radius_km == 13.76 * 695_700.0

    assert attrs.facts["planets"] == [
             %{
               "key" => "exoplanet-11-com-b",
               "name" => "11 Com b",
               "discovery_method" => "Radial Velocity",
               "period_days" => 323.21
             }
           ]

    assert attrs.search_text =~ "11 com b"
    assert attrs.search_text =~ "radial velocity"
    assert attrs.search_text =~ "g8 iii"
  end

  test "keeps the host planet list short and puts the orbit facts on the planet row" do
    system = %{
      "key" => "exosys-trappist-1",
      "name" => "TRAPPIST-1",
      "ra_deg" => 346.6263919,
      "dec_deg" => -5.0434618,
      "distance_pc" => 12.42988881,
      "system_planet_count" => 7,
      "planets" => [
        %{
          "key" => "exoplanet-trappist-1-e",
          "name" => "TRAPPIST-1 e",
          "radius_earth" => 0.92,
          "mass_earth" => 0.692,
          "mass_provenance" => "Mass",
          "period_days" => 6.101013,
          "period_days_err_plus" => 3.5e-5,
          "period_days_err_minus" => 3.5e-5,
          "semi_major_axis_au" => 0.02925,
          "semi_major_axis_au_err_plus" => 0.0025,
          "eccentricity" => 0.0051,
          "inclination_deg" => 89.793,
          "argument_of_periastron_deg" => 108.37,
          "discovery_method" => "Transit",
          "discovery_year" => 2017,
          "detected_by_transit" => true,
          "transit_timing_variations" => true,
          "orbit_display_state" => "position",
          "ephemeris_reference_type" => "conjunction",
          "ephemeris_reference_time_jd" => 2_457_660.3676621,
          "ephemeris_reference_time_jd_err_plus" => 1.43e-5,
          "ephemeris_period_days" => 6.09956479,
          "ephemeris_period_days_err_plus" => 1.78e-6,
          "ephemeris_time_system" => "BJD-TDB",
          "ephemeris_source_table" => "ps",
          "ephemeris_reference_label" => "Ducrot et al. 2020",
          "references" => [
            %{
              "label" => "Agol et al. 2021",
              "url" => "https://ui.adsabs.harvard.edu/abs/2021PSJ.....2....1A/abstract",
              "quantities" => ["period", "semi_major_axis", "radius", "mass"]
            }
          ]
        },
        %{
          "key" => "exoplanet-trappist-1-ring",
          "name" => "TRAPPIST-1 ring",
          "semi_major_axis_au" => 0.5,
          "orbit_display_state" => "orbit_only"
        }
      ]
    }

    host = Importer.attrs_for_entry!({:exoplanet_system, system})

    assert host.position_model == "exoplanet_archive_coordinates"

    assert host.facts["planets"] == [
             %{
               "key" => "exoplanet-trappist-1-e",
               "name" => "TRAPPIST-1 e",
               "radius_earth" => 0.92,
               "mass_earth" => 0.692,
               "period_days" => 6.101013,
               "semi_major_axis_au" => 0.02925,
               "discovery_method" => "Transit",
               "discovery_year" => 2017
             },
             %{
               "key" => "exoplanet-trappist-1-ring",
               "name" => "TRAPPIST-1 ring",
               "semi_major_axis_au" => 0.5
             }
           ]

    [planet, ring] =
      system
      |> StarsmapApi.Catalog.Importer.RowMapper.exoplanet_planet_entries()
      |> Enum.map(&Importer.attrs_for_entry!({:exoplanet, &1}))

    assert planet.key == "exoplanet-trappist-1-e"
    assert planet.parent_key == "exosys-trappist-1"
    assert planet.position_model == "exoplanet_archive_host_relative_orbit"
    # The stored coordinates stay on the host star; the browser adds the offset.
    assert {planet.x_au, planet.y_au, planet.z_au} == {host.x_au, host.y_au, host.z_au}
    assert planet.facts["orbit_display_state"] == "position"
    assert planet.facts["ephemeris_reference_type"] == "conjunction"
    assert planet.facts["ephemeris_reference_time_jd"] == 2_457_660.3676621
    assert planet.facts["ephemeris_reference_time_jd_err_plus"] == 1.43e-5
    assert planet.facts["ephemeris_period_days"] == 6.09956479
    assert planet.facts["ephemeris_time_system"] == "BJD-TDB"
    assert planet.facts["period_days_err_minus"] == 3.5e-5
    assert planet.facts["semi_major_axis_au_err_plus"] == 0.0025
    assert planet.facts["eccentricity"] == 0.0051
    assert planet.facts["inclination_deg"] == 89.793
    assert planet.facts["argument_of_periastron_deg"] == 108.37
    assert planet.facts["transit_timing_variations"] == true
    assert planet.facts["mass_provenance"] == "Mass"
    assert [%{"label" => "Agol et al. 2021"}] = planet.facts["references"]
    refute Map.has_key?(planet.facts, "minimum_mass")
    refute Map.has_key?(planet.facts, "eccentricity_limit")

    assert ring.position_model == "exoplanet_archive_host_relative_orbit"
    assert ring.facts["orbit_display_state"] == "orbit_only"
    refute Map.has_key?(ring.facts, "ephemeris_reference_type")
  end

  test "keeps the host-coordinates model for a planet with no orbit data" do
    system = %{
      "key" => "exosys-lensed",
      "name" => "Lensed",
      "ra_deg" => 10.0,
      "dec_deg" => -5.0,
      "distance_pc" => 2500.0,
      "planets" => [
        %{"name" => "Lensed b", "mass_earth" => 300.0, "orbit_display_state" => "none"},
        %{"name" => "Lensed c"}
      ]
    }

    rows =
      system
      |> StarsmapApi.Catalog.Importer.RowMapper.exoplanet_planet_entries()
      |> Enum.map(&Importer.attrs_for_entry!({:exoplanet, &1}))

    assert Enum.map(rows, & &1.key) == ["exoplanet-lensed-b", "exoplanet-lensed-c"]
    assert Enum.all?(rows, &(&1.position_model == "exoplanet_archive_host_coordinates"))
    assert Enum.all?(rows, &is_float(&1.x_au))
    refute Map.has_key?(hd(rows).facts, "semi_major_axis_au")
    assert hd(rows).facts["orbit_display_state"] == "none"
  end

  test "maps JPL small-body entries from cartesian positions" do
    attrs =
      Importer.attrs_for_entry!(
        {:small_body,
         %{
           "key" => "jpl-sbdb-20000001",
           "name" => "Ceres",
           "aliases" => ["Ceres", "JPL SPK-ID 20000001"],
           "object_type" => "asteroid",
           "parent_key" => "sun",
           "radius_km" => 469.7,
           "x_au" => 1.0,
           "y_au" => 2.0,
           "z_au" => 0.1,
           "absolute_magnitude" => 3.35,
           "external_ids" => %{"jpl_spkid" => "20000001", "primary_designation" => "1"},
           "facts" => %{"orbit_class" => "MBA", "neo" => false, "semi_major_axis_au" => 2.76},
           "why_interesting" =>
             "Asteroid with orbital elements from the NASA/JPL Small-Body Database."
         }}
      )

    assert attrs.key == "jpl-sbdb-20000001"
    assert attrs.object_type == "asteroid"
    assert attrs.catalog_group == "jpl_small_bodies"
    assert attrs.parent_key == "sun"
    assert attrs.x_km == 149_597_870.7
    assert attrs.external_ids == %{"jpl_spkid" => "20000001", "primary_designation" => "1"}
    assert attrs.facts["orbit_class"] == "MBA"
    assert attrs.search_text =~ "jpl spk-id 20000001"
    assert attrs.search_text =~ "mba"
  end

  test "maps Gaia DR3 local-star entries" do
    attrs =
      Importer.attrs_for_entry!(
        {:gaia_star,
         %{
           "key" => "gaia-dr3-123",
           "name" => "Gaia DR3 123",
           "aliases" => ["Gaia DR3 123"],
           "ra_deg" => 10.0,
           "dec_deg" => -20.0,
           "distance_pc" => 4.0,
           "parallax_mas" => 250.0,
           "apparent_magnitude" => 7.1,
           "absolute_magnitude" => 9.1,
           "source_id" => "123",
           "bp_rp" => 1.4,
           "pmra_mas_yr" => 100.0,
           "pmdec_mas_yr" => -50.0,
           "radius_km" => 200_000.0
         }}
      )

    assert attrs.catalog_group == "gaia_local_stars"
    assert attrs.source_type == "gaia_dr3"
    assert attrs.position_model == "gaia_dr3_epoch_2026_00_proper_motion_coordinates"
    assert attrs.external_ids == %{"gaia_dr3_source_id" => "123"}
    assert attrs.facts["source_id"] == "123"
    assert attrs.facts["source_epoch"] == 2016.0
    assert attrs.facts["position_epoch"] == 2026.0
    assert attrs.facts["catalog_ra_deg"] == 10.0
    assert attrs.facts["catalog_dec_deg"] == -20.0
    assert attrs.ra_deg != 10.0
    assert attrs.dec_deg != -20.0
    assert attrs.search_text =~ "gaia dr3 123"
  end

  test "maps the SIMBAD names of a Gaia star to external ids and to the search text" do
    attrs =
      Importer.attrs_for_entry!(
        {:gaia_star,
         %{
           "key" => "gaia-dr3-3220388198192519424",
           "name" => "StKM 1-561",
           "simbad_main_id" => "StKM 1-561",
           "aliases" => [
             "Gaia DR3 3220388198192519424",
             "Gaia 3220388198192519424",
             "3220388198192519424",
             "StKM 1-561",
             "HD 999",
             "HIP 42",
             "TIC 4206066",
             "TYC 4753-1591-1",
             "2MASS J05232636-0119380"
           ],
           "ra_deg" => 80.8598,
           "dec_deg" => -1.3270,
           "distance_pc" => 35.6,
           "parallax_mas" => 28.075,
           "apparent_magnitude" => 10.51,
           "source_id" => "3220388198192519424",
           "radius_km" => 466_000.0
         }}
      )

    assert attrs.key == "gaia-dr3-3220388198192519424"
    assert attrs.name == "StKM 1-561"

    assert attrs.external_ids == %{
             "gaia_dr3_source_id" => "3220388198192519424",
             "hd" => "HD 999",
             "hip" => "HIP 42",
             "tic" => "TIC 4206066"
           }

    assert attrs.facts["simbad_main_id"] == "StKM 1-561"
    assert "TIC 4206066" in attrs.aliases
    # With the space, with no space, by the SIMBAD name, and by the Gaia number.
    assert attrs.search_text =~ "tic 4206066"
    assert attrs.search_text =~ "tic4206066"
    assert attrs.search_text =~ "hd999"
    assert attrs.search_text =~ "stkm 1-561"
    assert attrs.search_text =~ "gaia dr3 3220388198192519424"
    refute attrs.search_text =~ "2massj"
  end

  test "maps SIMBAD extragalactic entries with redshift facts" do
    attrs =
      Importer.attrs_for_entry!(
        {:simbad_extragalactic,
         %{
           "key" => "simbad-3c-273",
           "name" => "3C 273",
           "aliases" => ["3C 273", "SIMBAD 3C 273"],
           "object_type" => "quasar",
           "ra_deg" => 187.2779,
           "dec_deg" => 2.0524,
           "distance_ly" => 2_400_000_000.0,
           "color" => "#d7c2ff",
           "radius_km" => 0.0,
           "external_ids" => %{"simbad_oid" => "123", "simbad_main_id" => "3C 273"},
           "facts" => %{"redshift" => 0.158, "simbad_object_type_label" => "Quasar"},
           "why_interesting" => "Quasar from SIMBAD."
         }}
      )

    assert attrs.key == "simbad-3c-273"
    assert attrs.object_type == "quasar"
    assert attrs.catalog_group == "simbad_extragalactic"
    assert attrs.source_type == "simbad_tap"
    assert attrs.facts["redshift"] == 0.158
    assert attrs.search_text =~ "quasar"
    assert attrs.search_text =~ "3c 273"
  end

  test "maps BASS DR2 mass-bearing entries as black holes with source evidence" do
    attrs =
      Importer.attrs_for_entry!(
        {:bass_dr2_black_hole,
         %{
           "key" => "bass-dr2-black-hole-1",
           "name" => "2MASX J00004876-0709117",
           "aliases" => ["SWIFT J0000.5-0709"],
           "ra_deg" => 0.2032,
           "dec_deg" => -7.1533,
           "distance_ly" => 337_000_000.0,
           "external_ids" => %{"bass_dr2_id" => "1"},
           "facts" => %{
             "bass_id" => "1",
             "black_hole_mass_log10_solar" => 7.91,
             "black_hole_mass_method" => "broad H-beta"
           },
           "why_interesting" =>
             "BASS DR2 active galaxy with a published black-hole mass estimate."
         }}
      )

    assert attrs.object_type == "black_hole"
    assert attrs.catalog_group == "bass_dr2_black_holes"
    assert attrs.source_type == "bass_dr2_black_hole_mass"
    assert attrs.position_model == "bass_dr2_catalog_distance_coordinates"
    assert attrs.facts["black_hole_mass_log10_solar"] == 7.91
    assert attrs.search_text =~ "broad h-beta"
    assert attrs.search_text =~ "swift j0000.5-0709"
  end

  test "neutralizes invalid OpenNGC galaxy parallax before projection" do
    attrs =
      Importer.attrs_for_entry!(
        {:ngc_ic_deep_sky,
         %{
           "key" => "ngc-224",
           "name" => "NGC 224 Andromeda Galaxy",
           "object_type" => "galaxy",
           "ra_deg" => 10.68479167,
           "dec_deg" => 41.26905556,
           "distance_pc" => 166.66666667,
           "distance_ly" => 543.59396283,
           "distance_quality" => "parallax",
           "facts" => %{"parallax_mas" => 6.0}
         }}
      )

    assert attrs.distance_pc == nil
    assert attrs.distance_ly == nil
    assert attrs.x_au == nil
    assert attrs.y_au == nil
    assert attrs.z_au == nil
    assert attrs.facts["distance_quality"] == "not_available"
  end

  test "upsert_source_objects chunks whole-catalog imports under the postgresql parameter limit" do
    rows =
      for index <- 1..2_000 do
        %{
          key: "gaia-chunk-#{index}",
          name: "Gaia Chunk #{index}",
          object_type: "star",
          catalog_group: "gaia_500pc_stars",
          source_type: "gaia_dr3",
          position_model: "catalog_coordinates",
          search_text: "gaia chunk #{index} star",
          x_au: index * 1.0,
          y_au: index * 2.0
        }
      end

    counts = SnapshotStore.upsert_source_objects(rows)

    assert Enum.sum(Map.values(counts)) == 2_000
  end

  test "import_report summarizes validation by source type" do
    rows = [
      %{
        key: "m1",
        name: "M1",
        catalog_group: "messier_deep_sky",
        object_type: "nebula",
        source_type: "deep_sky_catalog",
        x_au: 1.0,
        y_au: 2.0,
        ra_deg: 83.0,
        dec_deg: 22.0,
        source: %{"catalog" => "deep_sky"}
      },
      %{
        key: "m1",
        name: "M1 duplicate",
        catalog_group: "messier_deep_sky",
        object_type: "nebula",
        source_type: "deep_sky_catalog",
        x_au: 1.2,
        y_au: 2.2,
        ra_deg: 83.1,
        dec_deg: 22.1,
        source: %{"catalog" => "deep_sky"}
      },
      %{
        key: "jpl-sbdb-1",
        name: "Ceres",
        catalog_group: "jpl_small_bodies",
        object_type: "asteroid",
        source_type: "jpl_sbdb_query",
        x_au: nil,
        y_au: 2.0,
        ra_deg: nil,
        dec_deg: nil,
        source: %{"catalog" => "small_body"}
      }
    ]

    report = Importer.import_report(rows)

    assert report.total_rows == 3
    assert report[:valid?] == false
    assert report.duplicate_key_count == 1
    assert report.duplicate_keys == ["m1"]
    assert report.missing_map_position_count == 1
    assert report.missing_ra_dec_count == 1
    assert "1 duplicate catalog keys" in report.warnings
    assert "1 rows without projected map coordinates" in report.warnings

    assert report.source_types["deep_sky_catalog"].rows == 2
    assert report.source_types["deep_sky_catalog"].duplicate_key_count == 1
    assert report.source_types["deep_sky_catalog"].catalog_groups == %{"messier_deep_sky" => 2}
    assert report.source_types["deep_sky_catalog"].source_catalogs == %{"deep_sky" => 2}

    assert report.source_types["jpl_sbdb_query"].rows == 1
    assert report.source_types["jpl_sbdb_query"].missing_map_position_count == 1
  end

  test "import_all upserts rows from a catalog directory" do
    data_dir = tmp_catalog_dir()
    report_path = Path.join(data_dir, "reports/catalog-import-report.json")

    File.write!(
      Path.join(data_dir, "deep_sky_catalog.json"),
      Jason.encode!(%{
        "objects" => [
          %{
            "key" => "m1",
            "name" => "M1",
            "object_type" => "nebula",
            "ra_deg" => 83.625,
            "dec_deg" => 22.01666667,
            "distance_ly" => 6300.0
          }
        ]
      })
    )

    File.write!(
      Path.join(data_dir, "exoplanet_systems.json"),
      Jason.encode!(%{
        "systems" => [
          %{
            "key" => "exosys-test",
            "name" => "Test Host",
            "ra_deg" => 1.0,
            "dec_deg" => 2.0,
            "distance_pc" => 3.0,
            "planets" => [%{"name" => "Test Host b"}]
          }
        ]
      })
    )

    File.write!(
      Path.join(data_dir, "bright_stars.json"),
      Jason.encode!(%{
        "stars" => [
          %{
            "key" => "hip-1",
            "name" => "Bright Test",
            "ra_deg" => 4.0,
            "dec_deg" => 5.0,
            "distance_pc" => 6.0,
            "apparent_magnitude" => 1.2,
            "aliases" => ["HIP 1"]
          }
        ]
      })
    )

    File.write!(
      Path.join(data_dir, "bass_dr2_black_holes.json"),
      Jason.encode!(%{
        "objects" => [
          %{
            "key" => "bass-dr2-black-hole-test",
            "name" => "BASS Test",
            "ra_deg" => 12.0,
            "dec_deg" => -4.0,
            "distance_ly" => 100_000_000.0,
            "facts" => %{"black_hole_mass_log10_solar" => 8.0}
          }
        ]
      })
    )

    SnapshotStore.upsert_source_objects([
      %{
        key: "bass-dr2-black-hole-stale",
        name: "Stale BASS row",
        object_type: "black_hole",
        catalog_group: "bass_dr2_black_holes",
        source_type: "bass_dr2_black_hole_mass",
        position_model: "bass_dr2_catalog_distance_coordinates",
        x_au: 1.0,
        y_au: 1.0
      }
    ])

    assert {:ok, %{total: 5, counts: counts, report: report}} =
             Importer.import_all(data_dir: data_dir, report_path: report_path)

    assert counts == %{
             "bass_dr2_black_holes" => 1,
             "bright_stars" => 1,
             "exoplanet_systems" => 1,
             "exoplanets" => 1,
             "messier_deep_sky" => 1
           }

    assert report[:valid?] == true
    assert report.source_types["bass_dr2_black_hole_mass"].rows == 1
    assert report.source_types["bright_star_catalog"].rows == 1
    assert report.source_types["deep_sky_catalog"].rows == 1
    assert report.source_types["exoplanet_archive_system"].rows == 1
    assert report.source_types["exoplanet_archive_planet"].rows == 1

    assert count_source_table("catalog_stellar_stars") == 1
    assert count_source_table("catalog_deep_sky_objects") == 1
    assert count_source_table("catalog_exoplanet_objects") == 2
    assert count_source_table("catalog_bass_dr2_objects") == 1
    assert {:error, :not_found} = PublicObjects.get_by_key("bass-dr2-black-hole-stale")

    assert File.exists?(report_path)
    persisted_report = report_path |> File.read!() |> Jason.decode!()
    assert persisted_report["report"]["total"] == 5
    assert persisted_report["report"]["report"]["valid?"] == true
    assert persisted_report["report"]["report"]["source_types"]["deep_sky_catalog"]["rows"] == 1

    assert Repo.aggregate(CatalogSourceObject, :count, :id) == 5

    assert SnapshotStore.summary().source_counts == %{
             "bass_dr2_black_hole_mass" => 1,
             "bright_star_catalog" => 1,
             "deep_sky_catalog" => 1,
             "exoplanet_archive_planet" => 1,
             "exoplanet_archive_system" => 1
           }

    assert {:ok, %{object_type: "planet", parent_key: "exosys-test"}} =
             PublicObjects.get_by_key("exoplanet-test-host-b")

    assert {:ok, %{total: 5}} = Importer.import_all(data_dir: data_dir)
    assert Repo.aggregate(CatalogSourceObject, :count, :id) == 5
  end

  test "maps a TESS planet candidate system to a star row and candidate rows" do
    system =
      candidate_system("100", "111", [
        candidate("100", "01"),
        candidate("100", "02", %{"orbit_display_state" => "none", "semi_major_axis_au" => nil})
      ])

    host = Importer.attrs_for_entry!({:exoplanet_candidate_system, system})

    assert host.key == "toi-100"
    assert host.object_type == "star"
    assert host.catalog_group == "exoplanet_candidate_hosts"
    assert host.source_type == "tess_toi_host"
    assert host.position_model == "tess_toi_coordinates"
    assert host.external_ids == %{"tic" => "TIC 111"}
    assert host.facts["candidate_count"] == 2
    assert host.facts["stellar_mass_atlas_calculated"] == true

    assert [%{"key" => "toi-100-01", "disposition" => "planet_candidate"} = summary, _] =
             host.facts["candidates"]

    assert Map.keys(summary) |> Enum.sort() ==
             ~w(disposition key name period_days semi_major_axis_au)

    assert host.search_text =~ "toi-100.01"
    assert host.search_text =~ "toi100"
    assert host.search_text =~ "tic111"

    assert [first, second] =
             system
             |> RowMapper.exoplanet_candidate_entries(system)
             |> Enum.map(&Importer.attrs_for_entry!({:exoplanet_candidate, &1}))

    assert first.key == "toi-100-01"
    assert first.name == "TOI-100.01"
    assert first.object_type == "planet_candidate"
    assert first.catalog_group == "exoplanet_candidates"
    assert first.source_type == "tess_toi_candidate"
    assert first.position_model == "tess_toi_host_relative_orbit"
    assert first.parent_key == "toi-100"
    assert first.aliases == ["TOI-100.01", "TOI 100.01"]
    assert first.external_ids == %{"toi" => "100.01", "tic" => "TIC 111"}
    assert {first.x_au, first.y_au, first.z_au} == {host.x_au, host.y_au, host.z_au}
    assert first.facts["disposition"] == "planet_candidate"
    assert first.facts["tfopwg_disposition"] == "PC"
    assert first.facts["host_key"] == "toi-100"
    assert first.facts["host_name"] == "TOI-100"
    assert first.facts["semi_major_axis_atlas_calculated"] == true
    assert first.facts["ephemeris_reference_type"] == "conjunction"
    assert first.facts["ephemeris_reference_time_jd_err_plus"] == 0.002
    assert first.facts["why_interesting"] =~ "not a confirmed planet"
    assert first.search_text =~ "planet candidate"
    refute Map.has_key?(first.facts, "candidates")

    assert second.position_model == "tess_toi_host_coordinates"
    refute Map.has_key?(second.facts, "semi_major_axis_au")
  end

  test "import_all puts a candidate at the confirmed host with the same TIC number" do
    data_dir = tmp_catalog_dir()
    File.write!(Path.join(data_dir, "deep_sky_catalog.json"), Jason.encode!(%{"objects" => []}))

    File.write!(
      Path.join(data_dir, "exoplanet_systems.json"),
      Jason.encode!(%{
        "systems" => [
          %{
            "key" => "exosys-test",
            "name" => "Test Host",
            "aliases" => ["HD 1", "TIC 111"],
            "ra_deg" => 1.0,
            "dec_deg" => 2.0,
            "distance_pc" => 3.0,
            "planets" => [%{"name" => "Test Host b", "period_days" => 5.0}]
          }
        ]
      })
    )

    File.write!(
      Path.join(data_dir, "exoplanet_candidates.json"),
      Jason.encode!(%{
        "schema_version" => 1,
        "source" => %{"table" => "toi"},
        "systems" => [
          # TOI-100.01 has the period of the confirmed planet: it is that planet and is not imported.
          candidate_system("100", "111", [
            candidate("100", "01", %{"period_days" => 5.002}),
            candidate("100", "03")
          ]),
          candidate_system("200", "222", [candidate("200", "01")])
        ]
      })
    )

    assert {:ok, %{total: 5, counts: counts, report: report, source_table_counts: tables}} =
             Importer.import_all(data_dir: data_dir)

    assert counts == %{
             "exoplanet_systems" => 1,
             "exoplanets" => 1,
             "exoplanet_candidate_hosts" => 1,
             "exoplanet_candidates" => 2
           }

    assert report[:valid?] == true
    assert report.source_types["tess_toi_host"].rows == 1
    assert report.source_types["tess_toi_candidate"].rows == 2
    assert tables == %{"catalog_exoplanet_objects" => 5}
    assert count_source_table("catalog_exoplanet_objects") == 5

    # The star with TIC 111 is the confirmed host: it keeps its one row.
    assert {:error, :not_found} = PublicObjects.get_by_key("toi-100")
    assert {:ok, confirmed} = PublicObjects.get_by_key("exosys-test")
    assert confirmed.facts["candidate_count"] == 1
    assert [%{"key" => "toi-100-03", "name" => "TOI-100.03"}] = confirmed.facts["candidates"]
    assert [%{"name" => "Test Host b"}] = confirmed.facts["planets"]

    assert {:error, :not_found} = PublicObjects.get_by_key("toi-100-01")
    assert {:ok, at_confirmed} = PublicObjects.get_by_key("toi-100-03")
    assert at_confirmed.object_type == "planet_candidate"
    assert at_confirmed.parent_key == "exosys-test"
    assert at_confirmed.facts["host_name"] == "Test Host"
    assert at_confirmed.position == confirmed.position
    assert at_confirmed.source["catalog"] == "exoplanet_candidate_system"

    assert {:ok, toi_host} = PublicObjects.get_by_key("toi-200")
    assert toi_host.catalog_group == "exoplanet_candidate_hosts"

    assert {:ok, %{parent_key: "toi-200", position: position}} =
             PublicObjects.get_by_key("toi-200-01")

    assert position == toi_host.position
    refute position == confirmed.position

    # A second import replaces the rows and adds none.
    assert {:ok, %{total: 5}} = Importer.import_all(data_dir: data_dir)
    assert Repo.aggregate(CatalogSourceObject, :count, :id) == 5
  end

  test "maps Kepler, K2, and community candidates with the source types and models of their catalog" do
    koi =
      candidate_system("753", nil, [
        candidate("753", "01", %{
          "key" => "koi-753-01",
          "name" => "KOI-753.01",
          "toi" => nil,
          "aliases" => ["KOI 753.01"]
        })
      ])
      |> Map.merge(%{
        "catalog" => "koi",
        "key" => "koi-753",
        "name" => "KOI-753",
        "kic_id" => "10811496",
        "aliases" => ["KOI-753", "KIC 10811496"],
        "distance_source" => "Berger et al. 2020"
      })

    host = Importer.attrs_for_entry!({:exoplanet_candidate_system, koi})
    assert host.source_type == "kepler_koi_host"
    assert host.position_model == "kepler_koi_coordinates"
    assert host.catalog_group == "exoplanet_candidate_hosts"
    assert host.external_ids == %{"kic" => "KIC 10811496"}
    assert host.facts["distance_source"] == "Berger et al. 2020"
    assert host.search_text =~ "koi753"
    assert host.search_text =~ "kic10811496"

    assert [candidate] =
             koi
             |> RowMapper.exoplanet_candidate_entries(koi)
             |> Enum.map(&Importer.attrs_for_entry!({:exoplanet_candidate, &1}))

    assert candidate.source_type == "kepler_koi_candidate"
    assert candidate.position_model == "kepler_koi_host_relative_orbit"
    assert candidate.object_type == "planet_candidate"
    assert candidate.aliases == ["KOI-753.01", "KOI 753.01"]
    assert candidate.external_ids == %{"kic" => "KIC 10811496"}

    assert candidate.facts["why_interesting"] ==
             "A Kepler planet candidate at KOI-753. It is not a confirmed planet."

    assert candidate.search_text =~ "koi753.01"

    for {catalog, prefix} <- [{"k2", "k2_pandc"}, {"community", "community_report"}] do
      system =
        Map.put(
          candidate_system("9", "9", [candidate("9", "01", %{"orbit_display_state" => "none"})]),
          "catalog",
          catalog
        )

      assert Importer.attrs_for_entry!({:exoplanet_candidate_system, system}).source_type ==
               "#{prefix}_host"

      assert [row] =
               system
               |> RowMapper.exoplanet_candidate_entries(system)
               |> Enum.map(&Importer.attrs_for_entry!({:exoplanet_candidate, &1}))

      assert row.source_type == "#{prefix}_candidate"
      assert row.position_model == "#{prefix}_host_coordinates"
    end
  end

  test "import_all links a candidate star to a confirmed host by name and to a Gaia star by TIC number" do
    data_dir = tmp_catalog_dir()
    File.write!(Path.join(data_dir, "deep_sky_catalog.json"), Jason.encode!(%{"objects" => []}))

    File.write!(
      Path.join(data_dir, "exoplanet_systems.json"),
      Jason.encode!(%{
        "systems" => [
          %{
            "key" => "exosys-kepler-11",
            "name" => "Kepler-11",
            "aliases" => ["TIC 1"],
            "ra_deg" => 1.0,
            "dec_deg" => 2.0,
            "distance_pc" => 3.0,
            "planets" => [%{"name" => "Kepler-11 b"}]
          }
        ]
      })
    )

    File.write!(
      Path.join(data_dir, "gaia_local_stars.json"),
      Jason.encode!(%{
        "stars" => [
          %{
            "key" => "gaia-dr3-3220388198192519424",
            "name" => "StKM 1-561",
            "source_id" => "3220388198192519424",
            "aliases" => ["Gaia DR3 3220388198192519424", "StKM 1-561", "TIC 4206066"],
            "ra_deg" => 80.86,
            "dec_deg" => -1.33,
            "distance_pc" => 35.62,
            "parallax_mas" => 28.075,
            "parallax_over_error" => 1598.0,
            "pmra_mas_yr" => -3.4,
            "pmdec_mas_yr" => 70.8
          }
        ]
      })
    )

    kepler =
      candidate_system("157", nil, [
        candidate("157", "07", %{"key" => "koi-157-07", "name" => "KOI-157.07"})
      ])
      |> Map.merge(%{
        "catalog" => "koi",
        "key" => "koi-157",
        "name" => "KOI-157",
        "host_identifiers" => ["Kepler-11", "KOI-157", "KIC 6541920"]
      })

    community =
      candidate_system("4206066", "4206066", [
        candidate("4206066", "01", %{
          "key" => "tic-4206066-3-18d",
          "name" => "TIC 4206066 3.18 d signal",
          "disposition" => "community_report"
        })
      ])
      |> Map.merge(%{
        "catalog" => "community",
        "key" => "tic-4206066",
        "name" => "TIC 4206066",
        "host_identifiers" => ["TIC 4206066"],
        "report_label" => "Fixture 2026"
      })

    File.write!(
      Path.join(data_dir, "exoplanet_candidates.json"),
      Jason.encode!(%{
        "schema_version" => 2,
        "sources" => %{
          "koi" => %{"table" => "cumulative"},
          "community" => %{"name" => "Community reports"}
        },
        "systems" => [kepler, community]
      })
    )

    assert {:ok, %{report: report}} = Importer.import_all(data_dir: data_dir)
    assert report[:valid?] == true
    assert report.source_types["kepler_koi_candidate"].rows == 1
    assert report.source_types["community_report_host"].rows == 1
    refute Map.has_key?(report.source_types, "kepler_koi_host")

    # The Kepler candidate is at the confirmed host with the name of the identifier list.
    assert {:error, :not_found} = PublicObjects.get_by_key("koi-157")
    assert {:ok, confirmed} = PublicObjects.get_by_key("exosys-kepler-11")
    assert [%{"key" => "koi-157-07"}] = confirmed.facts["candidates"]
    assert {:ok, at_confirmed} = PublicObjects.get_by_key("koi-157-07")
    assert at_confirmed.parent_key == "exosys-kepler-11"
    assert at_confirmed.position == confirmed.position
    assert at_confirmed.source["source"] == %{"table" => "cumulative"}

    # The community star has its own row at the position of the Gaia record of the same star.
    assert {:ok, gaia} = PublicObjects.get_by_key("gaia-dr3-3220388198192519424")
    assert gaia.facts["candidate_count"] == 1
    assert [%{"key" => "tic-4206066-3-18d"}] = gaia.facts["candidates"]
    assert {:ok, star} = PublicObjects.get_by_key("tic-4206066")
    assert star.catalog_group == "exoplanet_candidate_hosts"
    assert star.source_type == "community_report_host"
    assert star.position == gaia.position
    assert star.position_model == gaia.position_model
    assert star.facts["position_source_key"] == "gaia-dr3-3220388198192519424"
    assert star.facts["parallax_over_error"] == 1598.0
    assert star.facts["report_label"] == "Fixture 2026"
    assert star.source["source"] == %{"name" => "Community reports"}
    assert {:ok, signal} = PublicObjects.get_by_key("tic-4206066-3-18d")
    assert signal.parent_key == "tic-4206066"
    assert signal.position == gaia.position
    assert signal.position_model == "community_report_host_relative_orbit"
    assert signal.facts["disposition"] == "community_report"
  end

  defp candidate_system(star, tic_id, candidates) do
    %{
      "key" => "toi-#{star}",
      "name" => "TOI-#{star}",
      "aliases" => Enum.reject(["TOI-#{star}", tic_id && "TIC #{tic_id}"], &is_nil/1),
      "tic_id" => tic_id,
      "ra_deg" => 40.0,
      "dec_deg" => -10.0,
      "distance_pc" => 50.0,
      "stellar_radius_solar" => 1.0,
      "stellar_mass_solar" => 1.0,
      "stellar_mass_atlas_calculated" => true,
      "candidate_count" => length(candidates),
      "candidates" => candidates
    }
  end

  defp candidate(star, number, values \\ %{}) do
    Map.merge(
      %{
        "key" => "toi-#{star}-#{number}",
        "name" => "TOI-#{star}.#{number}",
        "toi" => "#{star}.#{number}",
        "aliases" => ["TOI #{star}.#{number}"],
        "disposition" => "planet_candidate",
        "tfopwg_disposition" => "PC",
        "period_days" => 10.0,
        "semi_major_axis_au" => 0.09,
        "semi_major_axis_atlas_calculated" => true,
        "orbit_display_state" => "position",
        "ephemeris_reference_type" => "conjunction",
        "ephemeris_time_system" => "BJD-TDB",
        "ephemeris_period_days" => 10.0,
        "ephemeris_reference_time_jd" => 2_460_000.5,
        "ephemeris_reference_time_jd_err_plus" => 0.002
      },
      values
    )
  end

  defp tmp_catalog_dir do
    path =
      Path.join(System.tmp_dir!(), "starsmap-importer-test-#{System.unique_integer([:positive])}")

    File.mkdir_p!(path)
    path
  end

  defp count_source_table(table_name) do
    %{rows: [[count]]} = Repo.query!("SELECT COUNT(*) FROM #{table_name}")
    count
  end
end
