defmodule StarsmapApi.Catalog.ImporterTest do
  use StarsmapApi.DataCase, async: true

  alias StarsmapApi.Catalog.CatalogObject
  alias StarsmapApi.Catalog.Importer

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
               "name" => "11 Com b",
               "discovery_method" => "Radial Velocity",
               "period_days" => 323.21
             }
           ]

    assert attrs.search_text =~ "11 com b"
    assert attrs.search_text =~ "radial velocity"
    assert attrs.search_text =~ "g8 iii"
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
           "radius_km" => 200_000.0
         }}
      )

    assert attrs.catalog_group == "gaia_local_stars"
    assert attrs.source_type == "gaia_dr3"
    assert attrs.external_ids == %{"gaia_dr3_source_id" => "123"}
    assert attrs.facts["source_id"] == "123"
    assert attrs.search_text =~ "gaia dr3 123"
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

  test "import_all upserts rows from a catalog directory" do
    data_dir = tmp_catalog_dir()

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

    assert {:ok, %{total: 3, counts: counts}} = Importer.import_all(data_dir: data_dir)
    assert counts == %{"bright_stars" => 1, "exoplanet_systems" => 1, "messier_deep_sky" => 1}
    assert Repo.aggregate(CatalogObject, :count) == 3

    assert {:ok, %{total: 3}} = Importer.import_all(data_dir: data_dir)
    assert Repo.aggregate(CatalogObject, :count) == 3
  end

  defp tmp_catalog_dir do
    path =
      Path.join(System.tmp_dir!(), "starsmap-importer-test-#{System.unique_integer([:positive])}")

    File.mkdir_p!(path)
    path
  end
end
