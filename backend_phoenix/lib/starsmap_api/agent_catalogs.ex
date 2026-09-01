defmodule StarsmapApi.AgentCatalogs do
  @moduledoc "Verified public catalog and display-layer identifiers used by agent surfaces."

  @display_layers [
    %{id: "grid", label: "Coordinate grid"},
    %{id: "labels", label: "Object labels"},
    %{id: "milkyWay", label: "Milky Way context"},
    %{id: "milkyWayArms", label: "Schematic Milky Way arms"},
    %{id: "milkyWayDust", label: "Schematic Milky Way dust"},
    %{id: "milkyWayGuides", label: "Milky Way guide labels"},
    %{id: "orbits", label: "Solar System orbit paths"},
    %{id: "references", label: "Off-screen reference hints"}
  ]

  @catalogs [
    %{
      id: "solar_system_ephemeris",
      label: "Solar System ephemerides",
      kind: "ephemeris",
      search_group: nil,
      source_name: "NASA/JPL Solar System Dynamics and Horizons",
      source_url: "https://ssd.jpl.nasa.gov/horizons/",
      coverage: "Solar System bodies rendered for the selected epoch",
      caveat: "Positions are for atlas orientation; JPL source products remain authoritative."
    },
    %{
      id: "bright_stars",
      label: "Hipparcos bright stars",
      kind: "catalog",
      search_group: "bright_stars",
      source_name: "Hipparcos Main Catalogue via CDS/VizieR",
      source_url: "https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239",
      coverage: "Bright stars selected from Hipparcos with positive parallax",
      caveat: "The atlas snapshot applies documented magnitude and parallax selections."
    },
    %{
      id: "gaia_local_stars",
      label: "Gaia DR3 local stars",
      kind: "catalog",
      search_group: "gaia_local_stars",
      source_name: "ESA Gaia DR3",
      source_url: "https://gea.esac.esa.int/archive/",
      coverage: "A quality-filtered local-neighborhood Gaia DR3 snapshot",
      caveat: "This is a selected subset, not the complete Gaia archive."
    },
    %{
      id: "gaia_500pc_stars",
      label: "Gaia DR3 500 pc point layer",
      kind: "bulk_layer",
      search_group: "gaia_500pc_stars",
      source_name: "ESA Gaia DR3",
      source_url: "https://gea.esac.esa.int/archive/",
      coverage: "Bulk level-of-detail star points within the configured 500 pc release",
      caveat: "Point layers are selected visualization releases, not a catalog dump."
    },
    %{
      id: "gaia_10kpc_bright_stars",
      label: "Gaia DR3 bright 10 kpc point layer",
      kind: "bulk_layer",
      search_group: "gaia_10kpc_bright_stars",
      source_name: "ESA Gaia DR3",
      source_url: "https://gea.esac.esa.int/archive/",
      coverage: "A magnitude- and quality-selected Gaia DR3 visualization layer",
      caveat: "The layer is intentionally incomplete and uses level-of-detail rendering."
    },
    %{
      id: "exoplanet_systems",
      label: "Confirmed exoplanet host systems",
      kind: "catalog",
      search_group: "exoplanet_systems",
      source_name: "NASA Exoplanet Archive",
      source_url: "https://exoplanetarchive.ipac.caltech.edu/",
      coverage: "Host systems and confirmed planets from an imported archive snapshot",
      caveat: "Confirm current discovery status and parameters in the upstream archive."
    },
    %{
      id: "jpl_small_bodies",
      label: "JPL small bodies",
      kind: "catalog",
      search_group: "jpl_small_bodies",
      source_name: "NASA/JPL Small-Body Database",
      source_url: "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html",
      coverage: "A bounded selection of asteroids, comets, and other small bodies",
      caveat: "Osculating elements and propagated atlas positions are epoch-sensitive."
    },
    %{
      id: "messier_deep_sky",
      label: "Messier deep-sky objects",
      kind: "catalog",
      search_group: "messier_deep_sky",
      source_name: "Curated Messier catalog snapshot",
      source_url: "https://simbad.cds.unistra.fr/",
      coverage: "Named Messier galaxies, nebulae, and star clusters",
      caveat: "Entries are an orientation set; source services remain authoritative."
    },
    %{
      id: "ngc_ic_deep_sky",
      label: "OpenNGC NGC/IC objects",
      kind: "catalog",
      search_group: "ngc_ic_deep_sky",
      source_name: "OpenNGC",
      source_url: "https://github.com/mattiaverga/OpenNGC",
      coverage: "Generated NGC and IC deep-sky object records",
      caveat: "Distances are omitted unless their source semantics pass atlas validation."
    },
    %{
      id: "simbad_extragalactic",
      label: "SIMBAD extragalactic objects",
      kind: "catalog",
      search_group: "simbad_extragalactic",
      source_name: "SIMBAD astronomical database",
      source_url: "https://simbad.cds.unistra.fr/",
      coverage: "A selected snapshot of extragalactic objects",
      caveat: "The atlas does not mirror the complete or live SIMBAD database."
    },
    %{
      id: "simbad_compact_objects",
      label: "SIMBAD compact objects",
      kind: "catalog",
      search_group: "simbad_compact_objects",
      source_name: "SIMBAD astronomical database",
      source_url: "https://simbad.cds.unistra.fr/",
      coverage: "A selected snapshot of pulsars, compact objects, and related landmarks",
      caveat: "Object classifications and measurements should be checked upstream."
    },
    %{
      id: "desi_dr1_galaxies",
      label: "DESI DR1 galaxies",
      kind: "bulk_layer",
      search_group: "desi_dr1_galaxies",
      source_name: "Dark Energy Spectroscopic Instrument Data Release 1",
      source_url: "https://data.desi.lbl.gov/doc/releases/dr1/",
      coverage: "Survey-scale galaxy point tiles with on-demand selected-object details",
      caveat: "Rendering uses bounded point tiles and is not a bulk data access service."
    },
    %{
      id: "desi_dr1_quasars",
      label: "DESI DR1 quasars",
      kind: "bulk_layer",
      search_group: "desi_dr1_quasars",
      source_name: "Dark Energy Spectroscopic Instrument Data Release 1",
      source_url: "https://data.desi.lbl.gov/doc/releases/dr1/",
      coverage: "Survey-scale quasar point tiles with on-demand selected-object details",
      caveat: "Rendering uses bounded point tiles and is not a bulk data access service."
    },
    %{
      id: "quaia_g20_quasars",
      label: "Quaia G20 quasars",
      kind: "bulk_layer",
      search_group: "quaia_g20_quasars",
      source_name: "Quaia all-sky quasar catalog",
      source_url: "https://doi.org/10.3847/1538-4357/ad1328",
      coverage: "A survey-scale quasar visualization layer",
      caveat: "The point layer is a visualization release, not the upstream catalog."
    },
    %{
      id: "bass_dr2_black_holes",
      label: "BASS DR2 active galactic nuclei",
      kind: "catalog",
      search_group: "bass_dr2_black_holes",
      source_name: "BASS Data Release 2 via CDS/VizieR",
      source_url: "https://cdsarc.cds.unistra.fr/viz-bin/cat/J/ApJS/261/2",
      coverage: "Selected mass-bearing active-galaxy records",
      caveat: "Upstream citation and redistribution terms apply."
    },
    %{
      id: "erosita_dr2_xray",
      label: "eROSITA-DE DR2 point sources",
      kind: "catalog",
      search_group: "erosita_dr2_xray",
      source_name: "eROSITA-DE Data Release 2",
      source_url: "https://erosita.mpe.mpg.de/dr2/",
      coverage: "Imported eRASS:3 X-ray point-source records",
      caveat: "Consult the eROSITA archive for current release products and scientific use."
    },
    %{
      id: "erosita_dr2_extended",
      label: "eROSITA-DE DR2 extended sources",
      kind: "catalog",
      search_group: "erosita_dr2_extended",
      source_name: "eROSITA-DE Data Release 2",
      source_url: "https://erosita.mpe.mpg.de/dr2/",
      coverage: "Imported eRASS:3 X-ray extended-source records",
      caveat: "Consult the eROSITA archive for current release products and scientific use."
    },
    %{
      id: "sdss_spiders_dr20",
      label: "SDSS-V DR20 SPIDERS",
      kind: "catalog",
      search_group: "sdss_spiders_dr20",
      source_name: "Sloan Digital Sky Survey DR20",
      source_url: "https://www.sdss.org/dr20/",
      coverage: "SPIDERS DL1 optical spectroscopy for eROSITA targets",
      caveat: "Use SDSS release documentation and spectra for quantitative analysis."
    }
  ]

  def catalogs, do: @catalogs
  def display_layers, do: @display_layers
  def display_layer_ids, do: Enum.map(@display_layers, & &1.id)

  def find(id) when is_binary(id), do: Enum.find(@catalogs, &(&1.id == id))
  def find(_), do: nil
end
