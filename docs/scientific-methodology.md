# Scientific Methodology

Cosmic Atlas is a physical-scale browser for catalog records. It combines
measurements and published models from several sources, so the interface keeps
coordinate frame, epoch, distance evidence, selection effects, and provenance
visible instead of presenting every position as equally certain.

## Coordinate frame and projection

Positions are normalized to heliocentric ecliptic Cartesian coordinates. The
default map displays a top-down projection of the `x` and `y` axes. Source `z`
values remain in catalog records but are not used as a visibility cut. The map
ruler therefore measures projected `x/y` separation, not full
three-dimensional separation.

The 3D universe view uses the same measured or source-modeled `x/y/z`
coordinates and moves an observer freely through that frame. Its catalog query
includes only records with finite values on all three axes and returns a
bounded sample combining nearby positions with bright catalog landmarks.
Nearby stars are queried within a smaller volume than nonstellar objects so
dense star tables remain responsive. The 3D query also reserves a small
nearby-galaxy sample (within 300 billion AU) so those landmarks are not lost
among the brighter stars. Guided deep-sky highlights are reserved separately.
The sample is incomplete. In 3D, catalog apparent
magnitudes are scaled by the observer-to-object distance relative to the
catalog's heliocentric distance. Solid Solar System bodies and stars with a
supplied physical radius are rendered
as ray-intersected spheres at their geometric angular size. Nearby limbs and
interior viewpoints therefore do not collapse to brightness-sized points.
Guided galaxies, nebulae, and star clusters with a catalog size are drawn as
object-local 3D particle volumes at their estimated enclosing radius. Spiral
arms, cluster distributions, remnant shells, and nebular clouds are
illustrative reconstructions: orientation, internal depths, and individual
particles are not measured. Active-galaxy highlights without a reported size
use an explicitly labeled schematic 50,000-light-year radius, not a physical
size measurement. Other deep-sky objects remain catalog symbols. Sunlight
determines the illuminated side of solid bodies. Credited NASA, JPL and Solar
System Scope maps supply planetary detail; Earth has a separate static cloud
layer and the Moon uses elevation-based shading. Unmapped surfaces, additional
relief and ring density are illustrative. Approximate axial tilts and texture
phases do not constitute a rotational ephemeris. Gas, dust and stars form stable,
depth-sorted deep-sky volumes; their colors are a visualization, not a naked-eye
exposure. See [appearance methodology and credits](universe-appearance.md). The inspector shows distance from the center
and altitude above the modeled radius of solid bodies. Deep-sky highlights
instead identify their structure or size as illustrative. The Sun uses
a 1-AU visual-magnitude reference; major planets use JPL's
[V(1,0) values](https://ssd.jpl.nasa.gov/planets/phys_par.html)
with inverse-distance and approximate Lambertian phase terms. Minor bodies
with an H value use the same geometric estimate. Ring tilt, atmospheric
scattering, and detailed phase laws are not modeled, so 3D magnitude values are
clearly marked as estimates, not ephemeris-grade predictions. Objects placed
on a reference shell or explicitly marked as having unknown distance are excluded
from 3D, including nearby and guided-highlight query results.
While the camera moves, a smaller deterministic subset is drawn; full sampled
detail returns when movement stops. The first 3D load retains a bounded global
landmark sample; subsequent camera-position refreshes query nearby objects only
and merge them with those landmarks. Held flight and autopilot refresh the local
sample at most once every 1.5 seconds, allowing an in-flight request to finish;
stopping or jumping to a destination also refreshes the surrounding sample.
This avoids repeating a full-catalog
brightness sort on each move. The destination search uses the same catalog as
the 2D atlas, but only objects with credible 3D positions can be selected.
Compact map tiles that omit line-of-sight position are not placed on an invented
plane in 3D. Movement step size is user-adjustable because the atlas spans from
kilometers to billions of light-years; changing that step does not rescale or
alter the underlying coordinates. Autopilot uses the same numeric value as an
AU-per-second travel speed, moving toward the selected object or straight ahead
if none is selected. It is a navigation control, not a physically constrained
spaceflight simulation; it pauses on arrival and does not resume automatically
from a shared URL.

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
or independently measured geometric distance. Dense DESI point tiles retain a
stable TARGETID but omit the line-of-sight coordinate and catalog RA/Dec to stay
compact. When a point or shared link is opened, the atlas resolves its primary
DR1 `zpix` and `photometry` row through NSF NOIRLab Astro Data Lab, then rebuilds
the same 3D projection and caches the result. If that service is unavailable,
an already visible tile point remains selectable but its richer detail and
survey imagery are explicitly unavailable rather than inferred from 2D data.

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

## Sky-survey imagery

Objects with valid ICRS right ascension and declination show two views: curated
mission imagery when available (otherwise all-sky DSS2 context), and an optical
color cutout from the DESI Legacy Imaging Surveys DR11 map. These are Earth-view
angular images centered on the catalog coordinates; they are not reprojected
onto the atlas canvas and do not supply or alter the object's physical distance.
Blank image regions can reflect the DR11 footprint rather than an absence of
astronomical sources. If the live DR11 cutout is rate-limited or unavailable,
the card clearly switches to an all-sky AllWISE infrared field from CDS/Aladin
instead of leaving a broken image or pretending the fallback is DR11.

## Primary sources

- [Gaia Data Release 3](https://www.cosmos.esa.int/web/gaia/dr3)
- [NASA/JPL Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html)
- [IAU Resolution B5 and dwarf-planet classifications](https://www.iau.org/static/resolutions/Resolution_GA26-5-6.pdf)
- [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/)
- [BASS Data Release 2](https://www.bass-survey.com/dr2.html)
- [BASS DR2 black-hole mass catalog at VizieR](https://cdsarc.cds.unistra.fr/viz-bin/cat/J/ApJS/261/2)
- [DESI Data Release 1](https://data.desi.lbl.gov/doc/releases/dr1/)
- [DESI DR1 at NSF NOIRLab Astro Data Lab](https://datalab.noirlab.edu/data/desi)
- [DESI Legacy Imaging Surveys Data Release 11](https://www.legacysurvey.org/dr11/)
- [Quaia G<20.0](https://doi.org/10.5281/zenodo.10403370)
- [OpenNGC](https://github.com/mattiaverga/OpenNGC)
- [HEASARC Nearby Galaxies Catalog](https://heasarc.gsfc.nasa.gov/W3Browse/galaxy-catalog/neargalcat.html)
- [eROSITA-DE Data Release 2](https://erosita.mpe.mpg.de/dr2/)
- [SDSS DR20 SPIDERS DL1 value-added catalog](https://data.sdss.org/sas/dr20/vac/mos/DL1_SDSS_eROSITA/v1_1_0/)

Each object record retains its own source metadata and external identifiers so
users can inspect the originating archive.
