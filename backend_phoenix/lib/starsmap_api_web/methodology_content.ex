defmodule StarsmapApiWeb.MethodologyContent do
  @moduledoc "Reusable, server-readable methodology copy for pages and future object templates."
  alias StarsmapApi.ScienceSemantics

  def sections do
    registry = ScienceSemantics.registry()

    [
      %{
        title: "What the map position means",
        plain:
          "Cosmic Atlas is a top-down physical map. It displays the heliocentric ecliptic x/y plane; z is retained in source records but is not a visibility cut. The ruler therefore measures projected x/y separation, not full 3D separation.",
        technical:
          get_in(registry, ["projection", "display"]) <>
            ". " <> get_in(registry, ["projection", "ruler"]),
        sources: [
          {"Checked-in coordinate and renderer contract",
           "https://github.com/Ferdev/skychart/blob/trunk/docs/scientific-methodology.md#coordinate-frame-and-projection"}
        ]
      },
      %{
        title: "Epochs and moving sources",
        plain:
          "A catalog release date, a catalog reference epoch, and the date shown by the atlas are different things. Cosmic Atlas names the applicable epoch and does not silently treat every source as current-day.",
        technical:
          "Gaia DR3 astrometry has reference epoch J2016.0. Atlas rows with complete proper motion may be propagated to J2026.0. Solar-system state and osculating-element records use their declared epochs.",
        sources: [
          {"Gaia DR3 documentation", "https://www.cosmos.esa.int/web/gaia/dr3"},
          {"JPL SBDB", "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html"}
        ]
      },
      %{
        title: "Distances and cosmology",
        plain:
          "Nearby-star distance can come from parallax; nearby-galaxy distance can come from published literature; distant-survey positions can use redshift converted to comoving distance. These are not interchangeable measurements.",
        technical:
          "DESI spectroscopic and Quaia inferred-redshift projections use the checked-in flat LambdaCDM parameters H0=67.66 km/s/Mpc, Omega_m=0.30966, and Omega_lambda=0.69034. Compact DESI tiles retain TARGETID; selected points resolve their primary zpix/photometry row through NSF NOIRLab Astro Data Lab before the same 3D projection is rebuilt. A comoving distance is not converted back into a precise measured redshift or lookback time in the UI.",
        sources: [
          {"Checked-in DESI projection pipeline",
           "https://github.com/Ferdev/skychart/blob/trunk/scripts/desi_bulk_pipeline.py"},
          {"DESI DR1", "https://data.desi.lbl.gov/doc/releases/dr1/"},
          {"DESI DR1 at NSF NOIRLab Astro Data Lab", "https://datalab.noirlab.edu/data/desi"},
          {"Quaia dataset", "https://doi.org/10.5281/zenodo.10403370"}
        ]
      },
      %{
        title: "Selection and survey footprints",
        plain:
          "A blank or dense patch may describe the observing survey, its quality cuts, or its footprint rather than the universe itself.",
        technical:
          "Gaia T2 uses positive-parallax and signal-to-noise tiers. DESI includes successful spectra inside its footprint and target/class cuts. Quaia G<20 is an almost-all-sky quasar-candidate catalog with inferred redshifts. HEASARC NEARGALCAT is a literature compilation, not a uniform volume-limited survey.",
        sources: [
          {"Gaia archive", "https://gea.esac.esa.int/archive/"},
          {"DESI DR1", "https://data.desi.lbl.gov/doc/releases/dr1/"},
          {"Quaia overview", "https://irsa.ipac.caltech.edu/data/Quaia/overview.html"},
          {"HEASARC NEARGALCAT",
           "https://heasarc.gsfc.nasa.gov/W3Browse/galaxy-catalog/neargalcat.html"}
        ]
      },
      %{
        title: "Tiles, sampling, and level of detail",
        plain:
          "The atlas may display a deterministic sample when a layer is too dense for a browser. Zooming changes the level of detail; it does not create synthetic objects.",
        technical:
          "SMP3 layers record source counts, retained point counts, raw point counts, and deterministic sample buckets per level. Sampling is uniform within a level and immutable releases make the visible density reproducible.",
        sources: [
          {"Checked-in tile pipeline contract",
           "https://github.com/Ferdev/skychart/blob/trunk/docs/tile-format.md#levels-and-sampling"}
        ]
      }
    ]
  end
end
