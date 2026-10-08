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
Galaxies, nebulae, and star clusters with a catalog morphology class and a
catalog size are drawn as object-local 3D particle volumes at their estimated
enclosing radius. This covers the Messier catalog and those NGC/IC records whose
facts give both; the class selects the form (for example globular or open
cluster, spiral or elliptical galaxy, diffuse or planetary nebula). Spiral
arms, cluster distributions, remnant shells, and nebular clouds are
illustrative reconstructions: orientation, internal depths, and individual
particles are not measured. Active-galaxy highlights without a reported size
use an explicitly labeled schematic 50,000-light-year radius, not a physical
size measurement. Deep-sky records with no morphology class or no derived size,
and pairs, groups, asterisms and double stars, remain catalog symbols. Sunlight
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
plane in 3D. Movement controls act as thrusters, and there is no manual speed
scale: when thrust starts from rest, the base speed is set to a quarter of the
distance to the nearest loaded object per second (to its surface when the radius
is known), because the atlas spans from kilometers to billions of light-years.
Held input starts near that base speed and keeps doubling it, each doubling
sooner than the last, up to 10^16 AU per second; opposite input brakes, and
release coasts to rest. None of this rescales or alters the underlying
coordinates. With a selected object, autopilot accelerates and then sheds speed
in proportion to the remaining distance, so it stops smoothly at a standoff
distance. "Go to object" and autopilot use the same standoff, which depends only
on the object and the field of view: a star's disk spans 22% of the shorter view
side, another solid body 30%, and the enclosing radius of a deep-sky form half
of it. Rigel and Antares therefore arrive at the same apparent size although
their radii differ fivefold. A record with no size uses a distance typical for
its type (1 AU for a star), which is a viewing convention, not a measurement. On a long leg the speed is first held at a steady cruise, a quarter of
the leg per second, so the progress is visible on the trip map; forward and back
input changes the pace. With no selection it cruises
straight ahead at the base speed or the speed last set with the thrusters. These
are navigation controls, not a physically constrained spaceflight simulation:
speeds are unbounded by the speed of light. The speed gauge is a logarithmic
indicator of the current speed, not a control. It marks the speed of light, and
the readout states each speed as a multiple of it, so the faster-than-light
speeds that make distant objects reachable in seconds are explicit. Autopilot
pauses on arrival and does not resume automatically from a shared URL.

The optional gravity route replaces the straight autopilot leg with an unpowered
coast: the minimum-energy Kepler ellipse between the current position and the
standoff point, about the Sun, or about a planet when both ends lie inside its
sphere of influence. It is flown prograde unless that arc would pass through the
central body. The path, the real flight time, and the orbital speed (vis-viva)
are those of that two-body orbit; only the playback is time-compressed. This is
a deliberately simple model. Every body stays at its position for the displayed
epoch, so the route is not a launch-window solution: a real mission aims at
where the target will be on arrival. Planetary flybys, perturbations from other
bodies, and the departure and arrival burns are not modeled. Beyond 100,000 AU
from the Sun, or when the two ends lie on one ray from the central body, no such
orbit applies and autopilot flies the direct route. The trip map is a top-down
projection onto the ecliptic plane and omits the z coordinate.

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

## Exoplanet orbits

The atlas shows each confirmed exoplanet of the NASA Exoplanet Archive table
`pscomppars` on an orbit around its host star, at true scale, at the atlas
time. The catalog stores a planet at the coordinates of its host. The browser
adds the orbit offset (`src/catalog/exoplanetOrbit.ts`).

### What is measured and what is a convention

| Quantity | Source | Display |
| --- | --- | --- |
| Orbit size (semi-major axis) | Archive | True scale. A flag shows when the archive calculated the value. |
| Orbit shape (eccentricity, argument of periastron) | Archive, when the two values are measured | Ellipse. If a value is absent or is only a limit: a circle, with a flag. |
| Position on the orbit (phase) | Period and conjunction time, or period and periastron time | Calculated for the atlas time, with its uncertainty. |
| Inclination to the sky plane | Archive, when measured | Measured value. If absent or only a limit: 90 degrees (edge-on), with a flag. |
| Node angle | Not in the table | Display convention for each planet. |

The archive gives no node angle. This is the direction of the orbit around the
line of sight. The atlas puts the line of nodes at 90 degrees to the line of
sight and parallel to the ecliptic plane. The top-down map then shows an
edge-on orbit as open as possible. For a host at an ecliptic pole the node is
the x axis. A ring on the map is thus correct in size and in the timing of the
planet, and is not a measurement of the orbit direction. The map states this in
one line near the scale bar when a ring is in view, the rings use a dashed line
style that Solar System orbits do not use, and the object inspector lists each
convention in use.

An edge-on orbit for an unmeasured inclination agrees with the minimum mass
(`M sin i`) that the archive gives for those planets.

### Frame and offset

`s` is the unit vector from the Sun to the host. `n` is the unit vector of
`k x s`, where `k` is the ecliptic north. `m` is `s x n`. With the angle `u`
from the node, the inclination `i`, and the distance `r` from the host, the
offset of the planet is

`r * [cos(u) * n + sin(u) * (cos(i) * m - sin(i) * s)]`.

`u` is 90 degrees at conjunction, where the planet is between the Sun and the
host. With an argument of periastron `w` and a true anomaly `f`, `u = w + f`.

### Phase and its uncertainty

- A conjunction time is preferred to a periastron time, because it does not
  depend on the argument of periastron. A periastron time is used only with
  the argument of periastron of the same solution.
- The composite table takes each value from the paper that the archive
  prefers for that value. A period and a reference time from two papers are
  not one ephemeris. The builder then reads the per-paper table `ps` and
  selects one row that has the two values: the archive default row first, then
  the newest paper. If no such row exists, the mixed values stay, a flag is
  set, and the marker is hollow.
- The phase is the phase that an observer in the Solar System sees at the
  atlas time. The light travel time is not removed; star positions use the
  same rule. A reference time in TDB or TT gets the 69.184 s offset from UTC.
  Barycentric, heliocentric, and unlabelled Julian dates are used as given.
- The 1-sigma phase uncertainty in orbits is
  `sqrt(sigma_T^2 + (N * sigma_P)^2) / P`. `N` is the number of orbits from the
  reference time to the atlas time. The larger of the two published
  uncertainties is used for each value. The uncertainty is "not available"
  when the archive gives no uncertainty for the period or for the time.
- A reference time more than one period after the snapshot date is not a
  measured epoch and is not used. The archive has such records with a wrong
  Julian-day offset.

### Display states

1. **Position calculated.** Orbit ring, planet marker, and an arc for the
   1-sigma phase interval. The marker is hollow when the uncertainty is 0.05
   to 0.25 orbit, when it is not available, or when the papers are mixed.
2. **Orbit only.** Orbit ring and no marker: there is no usable timing, or the
   uncertainty is more than 0.25 orbit at the atlas time. The atlas does not
   put the planet at an arbitrary point.
3. **No orbit.** No ring and no marker: the archive gives no orbit size. The
   planet stays a fact on its host star.

A planet has its own marker only when its orbit is at least 4 pixels wide. At
a smaller scale the host star represents the system. The snapshot of
2026-10-08 has 6,347 planets in 4,752 systems: 5,352 with a calculated
position, 568 with an orbit only, and 427 with no orbit.

### Precision

A tile quantizes each position to 1/65,535 of the tile span, which is 256 AU
at the finest exoplanet level. From one pixel of that step, the host stars and
planets draw from the viewport-object path with their 64-bit coordinates. The
WebGL body layer subtracts an origin near the camera before the Float32
conversion: absolute Float32 AU values have a step of 0.25 AU at 2.5 million
AU.

### Limits

- Papers do not use one convention for the argument of periastron. An
  eccentric ellipse can point the wrong way by 180 degrees, and a position
  from a periastron time can be wrong by the same angle.
- Transit timing variations make the true transit times deviate from a
  constant period (the inspector shows the archive flag).
- For a circumbinary planet the ring center is not one star (flag in the
  inspector).
- The curated nearby host stars and their archive records have the same
  coordinates (16 pairs, 0.0 AU apart on 2026-10-08) and draw as one marker.
  The Gaia or Hipparcos record of the same star uses its own astrometry and
  epoch: measured offsets from the archive record are 30 to 880 AU for Gaia
  and 1,666 AU for one Hipparcos record. At the scale of a close-in system
  that record is out of view. For a system some hundred AU wide it can show
  as a second star marker; the orbits are around the archive record.
- Planet candidates are not in this table. They are a separate layer; see
  [Planet candidates](#planet-candidates).
- The 3D view uses the same positions. It lights each exoplanet from its host
  star and uses one neutral material; see `docs/universe-appearance.md`.

## Planet candidates

The atlas shows the planet candidates of the NASA Exoplanet Archive TESS
Objects of Interest (TOI) table. A candidate is not a confirmed planet: TESS
found a signal that looks like a transit, and follow-up observations show
that many such signals have a different cause, for example an eclipsing
binary star. The inspector, the search result, the candidate list of a star,
and the map note each say that a candidate is not confirmed.

Selection (`scripts/build_exoplanet_candidate_catalog.py`):

- Rows with the TFOPWG disposition `PC` (planet candidate) or `APC` (ambiguous
  planet candidate). Confirmed planets (`CP`), known planets (`KP`), false
  positives (`FP`), and false alarms (`FA`) are not in the layer.
- Rows with a star distance. A star with no distance has no place in the
  atlas and the builder counts it in `coverage.excluded_no_distance`.
- A candidate that is not in the TOI table (for example a community candidate
  with no TOI number) is not in the layer.

Catalog records:

- A candidate has the object type `planet_candidate`, the group
  `exoplanet_candidates`, and the key `toi-<star number>-<candidate number>`.
  The confirmed planet count of a star does not include candidates.
- A star with the same TIC number as a confirmed-planet host is that host:
  its candidates are attached to the host record and use its coordinates.
  Each other star gets a record in the group `exoplanet_candidate_hosts`, at
  the coordinates and the distance of the TOI table (position model
  `tess_toi_coordinates`).

Orbit:

- The TOI table gives the period and the transit midpoint (BJD in TDB). It
  gives no orbit size and no star mass. The builder calculates the star mass
  from the surface gravity and the radius, `M = g R^2 / G`, and the orbit size
  from Kepler's third law, `a^3 = M P^2` (solar masses, years, AU). The facts
  `stellar_mass_atlas_calculated` and `semi_major_axis_atlas_calculated` mark
  these values, and the inspector says "calculated by the atlas".
- The uncertainty of the orbit size comes from the published uncertainties of
  the surface gravity and the radius, where the table has them. A mass below
  0.05 or above 5 solar masses, or with an uncertainty as large as the mass,
  gives no orbit.
- The position rules are those of a confirmed planet: the transit midpoint is
  the conjunction time, the orbit is a circle that is drawn edge-on, the node
  angle is the same display convention, and a phase uncertainty above 0.25
  orbit gives a ring and no marker. A candidate with no period, or with no
  usable star data, has the model `tess_toi_host_coordinates`: no ring and no
  marker.
- A candidate ring is violet and dotted. A confirmed-planet ring is blue and
  dashed. With a candidate ring in view, the map note says that candidates
  are not confirmed planets and that the atlas calculates their orbit size.

Limits:

- The map loads the stars of candidates only at view widths below 40
  light-years. No tile layer contains them, so a wide view does not show them.
- The Gaia or Hipparcos record of the same star uses its own astrometry, so
  it can show as a second star marker, as for a confirmed-planet host.
- The dispositions change when the TESS follow-up working group reviews a
  candidate. The snapshot shows the state at its generation time.

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
- [NASA Exoplanet Archive TESS Objects of Interest table](https://exoplanetarchive.ipac.caltech.edu/docs/API_TOI_columns.html)
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
