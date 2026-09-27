# 3D appearance and image credits

The universe navigator keeps catalog positions, radii, and navigation distances
separate from appearance. Images describe an object's appearance at their source
epoch. They are not live weather, a rotational ephemeris, or a naked-eye exposure
simulation. Unknown surfaces, internal deep-sky structure, and texture phases are
illustrative. No new physical distances or radii are inferred from the artwork.

## Planetary maps

All bundled files, original download URLs, retrieval dates, credits, byte sizes,
and SHA-256 checksums are recorded in
[`public/textures/universe/sources.json`](../public/textures/universe/sources.json).
Maps are unmodified downloads in equirectangular projection, north at the top.
Color maps are treated as display-encoded RGB, decoded before lighting and
encoded again for display. This is an approximate visual treatment, not calibrated
surface reflectance. Longitude phases and pole longitudes are illustrative;
approximate obliquities are fixed in the heliocentric ecliptic frame. Changing the
atlas date updates positions and the Sun-facing hemisphere, not map weather or
rotation phase.

| Files | Source and credit | Treatment and limits |
| --- | --- | --- |
| `jupiter.png` | [Hubble global map, 2019](https://science.nasa.gov/asset/hubble/jupiter-global-map-2019/). NASA, ESA, A. Simon (GSFC), M. H. Wong (UC Berkeley). | 2000 × 1000 map. Observed cloud bands and Great Red Spot. Missing polar caps above 80° blend to a representative color. Jupiter's radius and displayed altitude refer to the modeled cloud-top sphere. |
| `moon.jpg`, `moon-height.jpg` | [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/). NASA Scientific Visualization Studio, LROC and LOLA teams. | 2048 × 1024 albedo and 1024 × 512 8-bit elevation preview. Elevation is used as normalized, exaggerated shading relief, not metric displacement. Some polar appearance is synthesized in the source. |
| `earth.jpg`, `earth-clouds.jpg`, `mercury.jpg`, `venus.jpg`, `mars.jpg`, `saturn.jpg`, `uranus.jpg`, `neptune.jpg` | [Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). NASA imagery-based maps with adjusted colors and filled gaps. | 2K maps, unchanged. Earth clouds are a static composite; Venus shows its cloud deck. Atmospheric maps are representative. Terrain normal detail on Mars and other rocky surfaces without elevation data is procedural, not measured topography. |
| `io.jpg`, `europa.jpg`, `ganymede.jpg`, `callisto.jpg` | [JPL Jupiter maps](https://maps.jpl.nasa.gov/tmaps/jupiter.html). NASA/JPL/Caltech/USGS, David Seal; Voyager mosaics, with Galileo color on Io. | 1440 × 720 processed mosaics; incomplete coverage and enhanced colors. |
| `phobos.jpg`, `deimos.jpg` | [JPL Mars maps](https://maps.jpl.nasa.gov/tmaps/mars.html). NASA/JPL/Caltech/USGS, Viking. | 1440 × 720 grayscale mosaics. Nuclei retain nominal catalog-radius geometry; surface roughness is illustrative. |
| `mimas.jpg`, `enceladus.jpg`, `tethys.jpg`, `dione.jpg`, `rhea.jpg`, `iapetus.jpg` | [JPL Saturn maps](https://maps.jpl.nasa.gov/tmaps/saturn.html). NASA/JPL/Caltech/USGS, David Seal; Voyager. | 1440 × 720 processed mosaics with incomplete coverage. |

NASA and JPL materials retain the listed source credits; no endorsement is
implied. JPL explicitly describes these maps as visualization assets unsuitable
for scientific image analysis. Solar System Scope permits redistribution and
adaptation under CC BY 4.0. Runtime spherical projection, lighting, lunar normal
perturbation, and Earth cloud compositing change their displayed appearance.

Saturn's rings use an illustrative radial optical-density profile, a thin tilted
plane, Cassini/Encke-like gaps, two-sided illumination, and mutual planet/ring
shadows. The rings are not a particle simulation. Earth uses separate cloud
opacity, approximate ocean highlights, and a thin blue limb. The Moon and other
rocky bodies use matte lighting. Sun/stars are emissive with limb darkening and
a restrained halo; catalog stellar color is retained where available. Unknown
small-body, dwarf-planet, moon, and exoplanet surfaces use rough procedural
materials rather than copying another planet's observed map.

## Guided deep-sky reconstructions

All 19 existing guided records remain supported. M87 and `simbad-m-87` share
one deterministic appearance profile; overlapping representations are drawn
once while the selected record retains its own position and size. The two
quasars retain their explicit schematic-size label. Other model extents use
the existing catalog radius, including its uncertainty.

| Targets | Distinguishing visual structure |
| --- | --- |
| M31, M33, M51, M81, M77 | Different inclinations, bulge concentrations, arm counts/winding, blue young populations, emission knots and absorbing dust lanes; M51 includes an illustrative companion/bridge within its profile. |
| M82 | Elongated starburst, central dust and bipolar red outflows. |
| M87 (both records) | Diffuse warm elliptical halo with a narrow blue jet. |
| M1 | Filamentary shell surrounding a softer blue interior. |
| M8, M16, M17, M20, M42 | Uneven gas volumes, cavities and dark lanes; M16 has pillar-like obscuration, M17 an arc, M20 branching lanes. |
| M57 | Bright equatorial rim around an elongated, filled shell. |
| M13, M45 | Concentrated globular stars versus a loose blue cluster with reflection wisps. |
| 3C 273, 3C 279 | Bright active nuclei and narrow jets; overall dimensions remain schematic. |

These profiles are interpretations of the familiar Earth-facing morphology in
the [NASA Hubble Messier catalog](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/).
The [Ring Nebula shape analysis](https://science.nasa.gov/missions/hubble/hubble-reveals-the-ring-nebulas-true-shape/)
motivates a filled elongated shell instead of a torus.
The [M87 jet image](https://science.nasa.gov/asset/hubble/galaxy-m87-jet-annotated/)
motivates the halo/jet distinction. Internal depths, exact orientations, dust
opacities, colors and individual particles are inferred artwork, not measured
stars or a tomographic reconstruction. The camera can fly around and through the
stable volumes, revealing parallax rather than rotating a flat photograph.

## Resource limits and fallback

Textures load only for resolved bodies (12 pixels in radius; detail maps at 40).
The cache budgets decoded images and GPU textures together at 48 MiB, limits
entries, evicts unused maps, remembers failures, and releases resources when 3D
closes. Sources are at most 2K and load from this application, not third-party
servers. Uploads use power-of-two mipmaps (non-power-of-two originals are
resampled in the browser); a narrow longitude blend softens mosaic seams.
Missing images preserve the procedural
material. Context restoration recreates GPU assets and requests a fresh frame.
The body layer caps its drawing buffer at two million pixels, reduced to 400,000
during flight and 600,000 for interior viewpoints. This bounds full-screen
fragment work; stopping outside a body restores the sharper close-up view.

Deep-sky gas and dust use depth-sorted Gaussian quads with a 24,000-splat frame
budget, reduced to 12,000 for movement and narrow viewports. A separate projected
area budget limits overdraw inside nearby gas volumes. Density compensation
reduces brightness changes between detail levels. Models and distant markers
crossfade between 1.5 and 6 pixels in radius. Camera-relative projection uses
CPU double precision. Up to eight largest visible opaque bodies mask background
particles; foreground particles remain visible. Saturn’s ring transmission also attenuates background catalog points and gas.

Without WebGL, a reduced-resolution CPU ray caster retains textured spheres,
perspective, interior views and simplified rings. Relief and atmospheric glow
are reduced; deep-sky volumes use sorted Canvas gradients. Performance figures
from headless browser fixtures do not establish desktop or phone frame rates.
