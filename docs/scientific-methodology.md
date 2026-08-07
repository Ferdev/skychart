# Scientific Methodology

Cosmic Atlas is a physical-scale browser for catalog records. It combines
measurements and published models from several sources, so the interface keeps
coordinate frame, epoch, distance evidence, selection effects, and provenance
visible instead of presenting every position as equally certain.

## Coordinate frame and projection

Positions are normalized to heliocentric ecliptic Cartesian coordinates. The
map displays a top-down projection of the `x` and `y` axes. Source `z` values
remain in catalog records but are not used as a visibility cut. The map ruler
therefore measures projected `x/y` separation, not full three-dimensional
separation.

Solar System state vectors and catalog coordinates enter this frame through
different pipelines. A matching map position does not imply that two records
share the same measurement method or epoch.

## Epochs and motion

A catalog release date, a reference epoch, and the date selected in the atlas
are distinct concepts.

- Gaia DR3 astrometry uses reference epoch J2016.0. Rows with a complete proper
  motion vector may be propagated to J2026.0; other rows retain their catalog
  epoch.
- J2000 catalog coordinates remain labeled as J2000 unless a source provides a
  supported motion model.
- Solar System objects use source-declared state or osculating-element epochs
  and may be propagated to the selected atlas time.

The machine-readable position-model registry is checked in at
`backend_phoenix/priv/science_semantics.json`.

## Distance evidence

The atlas distinguishes the evidence behind a distance:

- nearby stars can use geometric parallax;
- nearby galaxies can use published literature distances;
- spectroscopic survey objects can use measured redshift converted to
  line-of-sight comoving distance;
- Quaia candidates use inferred spectrophotometric redshifts produced by its
  machine-learning model and are labeled separately from spectroscopy;
- Solar System positions come from ephemeris state or orbital models rather
  than a static catalog distance.

BASS DR2 black-hole records use the catalog's published distance and mass
estimate. Their map position is a catalog-coordinate projection; the point is
not intended to represent an event-horizon radius or a directly imaged black
hole. Dwarf-planet classification follows the five bodies formally recognized
by the International Astronomical Union, while their orbital and physical
parameters remain attributed to JPL sources.

DESI and Quaia projections use a checked-in flat Lambda-CDM convention with
`H0 = 67.66 km/s/Mpc`, `Omega_m = 0.30966`, and `Omega_lambda = 0.69034`.
Comoving distance is a display coordinate, not a claim of exact lookback time
or independently measured geometric distance.

The eROSITA-DE DR2 and SDSS-V DR20 SPIDERS layers reuse the same cosmology.
SPIDERS rows use the BOSS spectroscopic redshift only when
`sdss_zwarning = 0`. eROSITA DR2 rows use the SIMBAD-compiled redshift shipped
with the DR2 Legacy Survey DR10 counterpart catalog; the upstream
documentation warns those values are not always reliable, and each row carries
that caveat in its facts. Sources of either catalog without a usable redshift
keep their measured sky position but are drawn on a fixed 1 billion light-year
reference shell (`catalog_sky_position_reference_shell`); the shell radius is
a display convention, recorded as `distance_unknown`, and is never presented
as a measurement.

## Selection effects and uncertainty

Catalog density follows survey coverage and quality cuts. Blank or dense
regions can describe a survey footprint rather than the underlying universe.
The interface exposes source counts, level-of-detail sampling, releases, and
selection caveats where they are available.

Missing uncertainty is shown as unavailable. The application does not invent
precision, convert unrelated quality fields into error bars, or treat a
literature compilation as a uniform volume-limited survey.

## Primary sources

- [Gaia Data Release 3](https://www.cosmos.esa.int/web/gaia/dr3)
- [NASA/JPL Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html)
- [IAU Resolution B5 and dwarf-planet classifications](https://www.iau.org/static/resolutions/Resolution_GA26-5-6.pdf)
- [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/)
- [BASS Data Release 2](https://www.bass-survey.com/dr2.html)
- [BASS DR2 black-hole mass catalog at VizieR](https://cdsarc.cds.unistra.fr/viz-bin/cat/J/ApJS/261/2)
- [DESI Data Release 1](https://data.desi.lbl.gov/doc/releases/dr1/)
- [Quaia G<20.0](https://doi.org/10.5281/zenodo.10403370)
- [OpenNGC](https://github.com/mattiaverga/OpenNGC)
- [HEASARC Nearby Galaxies Catalog](https://heasarc.gsfc.nasa.gov/W3Browse/galaxy-catalog/neargalcat.html)
- [eROSITA-DE Data Release 2](https://erosita.mpe.mpg.de/dr2/)
- [SDSS DR20 SPIDERS DL1 value-added catalog](https://data.sdss.org/sas/dr20/vac/mos/DL1_SDSS_eROSITA/v1_1_0/)

Each object record retains its own source metadata and external identifiers so
users can inspect the originating archive.
