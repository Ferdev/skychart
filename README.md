# Cosmic Atlas

Cosmic Atlas is a scientific 2D celestial atlas. It renders Solar System bodies, confirmed exoplanet host systems, Hipparcos bright stars, Gaia physical-map stars, JPL small bodies, DESI DR1 galaxies and quasars, SIMBAD extragalactic objects, BASS DR2 black-hole mass records, nearby stars, Messier deep-sky objects, and the generated OpenNGC NGC/IC deep-sky catalog in one heliocentric ecliptic coordinate space so they can be searched, inspected, centered, measured, and compared.

## What Is Included

- Sun, planets, Earth's Moon, Mars moons, major Jupiter and Saturn moons, Pluto, a nearby exoplanet-host star slice, a generated NASA Exoplanet Archive host-system snapshot, a generated Hipparcos bright-star slice, a generated ESA Gaia DR3 local-neighborhood slice, a generated NASA/JPL Small-Body Database slice, a generated SIMBAD extragalactic slice, and the full generated Messier catalog snapshot.
- Real current-date Solar System body positions from Skyfield using NASA/JPL DE440s, the NAIF Mars satellite SPK, and NASA/JPL Horizons vectors for major Jupiter and Saturn moons.
- Static confirmed exoplanet host-system positions projected from NASA Exoplanet Archive right ascension, declination, and distance, with confirmed planet lists attached to each host.
- Static Hipparcos bright-star positions projected from right ascension, declination, and parallax-derived distance, with apparent magnitude, color index, spectral type, and estimated stellar radius when enough catalog data is present.
- Static Gaia DR3 local-neighborhood star positions projected from right ascension, declination, and parallax-derived distance, with Gaia G magnitude, BP-RP color, proper-motion facts, and estimated stellar radius when enough catalog data is present.
- JPL Small-Body Database asteroids and comets propagated from osculating elements into approximate heliocentric ecliptic positions for search, viewport loading, and comparison.
- Static Messier deep-sky positions projected from catalog right ascension, declination, and distance estimates, with NGC/IC aliases where listed.
- OpenNGC NGC/IC deep-sky catalog entries generated from the OpenNGC `database_files/NGC.csv` snapshot, with stable `ngc-*` / `ic-*` keys, aliases, object classes, constellations, magnitudes, angular sizes, and distance projections when OpenNGC supplies positive parallax, redshift, or radial velocity.
- SIMBAD galaxies, quasars, and active galactic nuclei projected from RA/Dec and redshift-derived distance estimates, with SIMBAD and NED lookup links attached.
- A compact curated extragalactic survey landmark catalog covering Local Volume galaxies, Virgo/Fornax/Abell cluster anchors, Shapley/Great Attractor supercluster context, and famous 3C/APM/Tonantzintla quasars/blazars without a bulk survey download.
- Catalog metadata for each loaded object: object type, parent body, source kernel or catalog source, catalog group, and dynamic/static position model.
- Object inspection for physical radius, Earth distance, heliocentric distance, state-vector speeds, osculating orbital elements, stellar data, and deep-sky observing metadata.
- Curated NASA/JPL and NASA/Hubble media for selected high-value objects, plus coordinate-centered DESI Legacy Imaging Surveys DR11 cutouts and Sky Viewer links, with attribution shown directly in object detail.
- Distance measurement between selected objects or map points, including light-time and scale comparisons.
- UTC time controls: apply a timestamp, jump to now, or step by days/weeks/months.
- Map view controls for object labels, orbit guides, scale grid, Milky Way projection, edge references, zoom presets, and readable/hybrid/true-size rendering. Universe-scale structure is drawn only from measured catalog points; procedural filaments and density artwork are intentionally absent.
- Guided object sets for Solar neighborhood, bright stars, nearby stars, small bodies, Messier highlights, galaxies, active galaxies, nebulae, and universe-scale exploration.
- A scale ladder that marks whether the current viewport is planetary, Solar System, nearby-star, Milky Way, Local Group, galaxy-cluster, or cosmic-web scale.

## Install

Standard Python environment:

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m ensurepip
.venv/bin/python -m pip install -r requirements-dev.txt
```

On Nix/NixOS, use the included shell so Skyfield/NumPy get native library paths from Nix instead of pip wheels:

```bash
nix-shell
npm install
```

## Run

For the current Phoenix entrypoint, run the Python ephemeris API in one terminal:

```bash
nix-shell --run "python3 backend/server.py"
```

Then build the client bundle into Phoenix and start Phoenix in another terminal:

```bash
npm run build:phoenix
cd backend_phoenix
mix ecto.migrate
mix starsmap.import_catalogs
PORT=4020 mix phx.server
```

Then open:

```text
http://127.0.0.1:4020/
```

For Vite-only frontend development, start both the ephemeris API and Vite:

```bash
npm run dev:all
```

Then open the Vite URL printed in the terminal, usually:

```text
http://127.0.0.1:5173/
```

The first backend request downloads required kernels into `data/skyfield/`, so first launch can take a moment:

- `de440s.bsp` for the Sun, planets, Earth's Moon, and Pluto barycenter.
- `mar099s.bsp` for Phobos and Deimos.

The first Jupiter/Saturn moon positions are fetched from the NASA/JPL Horizons API rather than downloaded as very large local kernels. Expensive Horizons vectors and backend API payloads are cached under `data/cache/`. Default current-time requests are bucketed to five-minute UTC intervals so local reloads do not repeatedly hit Horizons for effectively identical startup data. Explicit timestamps from the time controls are computed at the requested UTC second.

You can also run the legacy Vite development processes separately:

```bash
.venv/bin/python backend/server.py
npm run dev
```

## Verify

For Phoenix-served UI changes, use the full browser-facing path rather than only the Vite build:

```bash
npm run build
npm run build:phoenix
ATLAS_BASE_URL=http://127.0.0.1:4020 npm run test:e2e
ATLAS_BASE_URL=http://127.0.0.1:4020 npm run test:perf
cd backend_phoenix && mix test
```

The Playwright tests expect the Phoenix app to be running, usually at `http://127.0.0.1:4020/`. They skip cleanly when that URL is unavailable.

## Catalog Data

Checked-in JSON catalogs and large streamed catalogs use separate import paths.
The idempotent wrapper applies migrations, imports snapshots, and skips large
catalog groups that already meet their validated minimum counts:

```bash
scripts/import_catalogs_if_needed.sh
```

For the official Gaia DR3 archive, choose a scratch location and use the
resumable offline ingester. It verifies source checksums, retains the columns
needed by the atlas, and writes one compressed Parquet file per archive chunk:

```bash
export GAIA_ROOT="$HOME/skychart-data/gaia"
export SKYCHART_ALLOW_BULK_PIPELINE=1
uv venv "$GAIA_ROOT/.venv"
uv pip install --python "$GAIA_ROOT/.venv/bin/python" -r scripts/gaia_bulk_requirements.txt
"$GAIA_ROOT/.venv/bin/python" scripts/download_gaia_dr3.py manifest --root "$GAIA_ROOT"
scripts/run_gaia_dr3_ingest.sh
```

Stopping and restarting is safe. Independent workers can share the output root
with `--shard-count` and distinct `--shard-index` values.

The universe-scale point layer is built offline from the official DESI DR1
`zall-pix-iron.fits` redshift catalog. `scripts/desi_bulk_pipeline.py` selects
primary successful main-survey galaxy and quasar spectra with `z >= 0.0001`, converts redshift to
documented flat-Lambda-CDM comoving distance, rotates coordinates into the
atlas ecliptic frame, and produces a deterministic Range-readable SMPK1
container. Run its `project`, `partition`, and `encode` commands in that order,
then verify the result with `scripts/audit_desi_bulk_release.py` and compose it
with the current release using `scripts/compose_desi_catalog_release.py`.

Because those compact tiles retain only projected coordinates and a DESI
TARGETID, selecting a DESI point resolves its matching DR1 `zpix` and
`photometry` record on demand through NSF NOIRLab Astro Data Lab. The cached
detail supplies the original RA/Dec, redshift, classification, and full 3D
position needed by shared links and coordinate-centered survey imagery.

```bash
export DESI_ROOT="$HOME/skychart-data/desi"
mkdir -p "$DESI_ROOT"/{source,work,artifact}
curl --continue-at - --output "$DESI_ROOT/source/zall-pix-iron.fits" \
  https://data.desi.lbl.gov/public/dr1/spectro/redux/iron/zcatalog/v1/zall-pix-iron.fits
echo "2d95ad99361039b556c402b49e0e7c84df5f00106dc5731d44476a58b128b49b  $DESI_ROOT/source/zall-pix-iron.fits" | sha256sum --check
"$GAIA_ROOT/.venv/bin/python" scripts/desi_bulk_pipeline.py project \
  --input "$DESI_ROOT/source/zall-pix-iron.fits" \
  --output "$DESI_ROOT/work/projected.parquet"
"$GAIA_ROOT/.venv/bin/python" scripts/desi_bulk_pipeline.py partition \
  --input "$DESI_ROOT/work/projected.parquet" \
  --output "$DESI_ROOT/work/partitioned"
"$GAIA_ROOT/.venv/bin/python" scripts/desi_bulk_pipeline.py encode \
  --input "$DESI_ROOT/work/partitioned" \
  --output "$DESI_ROOT/artifact" --version local
```

See [Catalog Tile Format](docs/tile-format.md) for the immutable browser
artifact contract and [Deployment](docs/deployment.md) for release flow.

## Data Source

The backend uses [Skyfield](https://rhodesmill.org/skyfield/) with the NASA/JPL `de440s.bsp` planetary ephemeris kernel. It also loads the NAIF `mar099s.bsp` satellite SPK for Mars' moons. Jupiter and Saturn major moons are fetched from the NASA/JPL Horizons API as parent-relative vectors and then placed into the same heliocentric ecliptic coordinate space as the Skyfield bodies.

Nearby exoplanet-host stars are a curated static slice from the NASA Exoplanet Archive. The broader exoplanet-system catalog comes from `data/catalogs/exoplanet_systems.json`, generated by `scripts/build_exoplanet_catalog.py` from the NASA Exoplanet Archive Planetary Systems Composite Parameters table. Host-system right ascension, declination, and distance are converted into heliocentric ecliptic Cartesian coordinates, and confirmed planets are shown as catalog facts on the host object. These stars and exoplanet systems are not JPL-propagated dynamic ephemeris bodies.

Bright stars are loaded from `data/catalogs/bright_stars.json`, generated by `scripts/build_bright_star_catalog.py` from the CDS/VizieR Hipparcos Main Catalogue. The snapshot includes stars with V magnitude `< 6.5` and positive parallax. The backend skips entries that duplicate already-loaded exoplanet host systems by name or alias.

Gaia local stars are loaded from `data/catalogs/gaia_local_stars.json`, generated by `scripts/build_gaia_local_catalog.py` from the ESA Gaia DR3 `gaiadr3.gaia_source` table. The default snapshot includes 33,170 nearby sources with parallax `>= 20 mas`, parallax-over-error `>= 10`, and Gaia G magnitude `<= 16`.

The larger Gaia point layers are imported directly into Phoenix/Postgres with `scripts/import_gaia_bulk_catalog.py --preset 500pc-g14` and `scripts/import_gaia_bulk_catalog.py --preset 10kpc-g14`. The current bulk slices target about 1.6 million Gaia DR3 sources between 50 and 500 pc plus about 13.15 million broader bright Gaia DR3 sources between 500 pc and 10 kpc, without creating multi-gigabyte JSON snapshots or increasing the app startup payload.

Small bodies are loaded from `data/catalogs/small_bodies.json`, generated by `scripts/build_small_body_catalog.py` from the NASA/JPL Small-Body Database Query API. The selection includes large diameter-known asteroids, bright near-Earth asteroids, non-fragment comets, and an explicit completeness set for the four IAU-recognized dwarf planets represented by SBDB rows: Ceres, Haumea, Makemake, and Eris. Pluto comes from the dynamic core ephemeris. Positions are approximate two-body propagations from SBDB osculating elements to each record's stated target timestamp, not full N-body ephemerides; IAU classification provenance is recorded separately from JPL orbital-data provenance.

Messier objects are loaded from a generated snapshot in `data/catalogs/deep_sky_catalog.json`. The generator script `scripts/build_deep_sky_catalog.py` pulls the AstroPixels Messier table for RA/Dec, distance estimates, apparent magnitude, angular size, constellation, season, and common names, and records NASA HEASARC Messier table notes as catalog context. When angular size and distance are available, the backend derives an estimated physical diameter for true-size rendering.

NGC and IC objects are loaded from `data/catalogs/ngc_ic_deep_sky.json`, generated by `scripts/build_ngc_ic_catalog.py` from the OpenNGC `database_files/NGC.csv` table. The snapshot skips duplicate and nonexistent OpenNGC rows, keeps stable keys such as `ngc-224` and `ic-434`, and imports 13k+ NGC/IC objects into the `ngc_ic_deep_sky` catalog group. Objects without trustworthy distance fields remain searchable by catalog position and metadata without inventing distances.

SIMBAD extragalactic objects are loaded from `data/catalogs/simbad_extragalactic.json`, generated by `scripts/build_simbad_extragalactic_catalog.py` from the SIMBAD TAP `basic` table. The current snapshot imports 5,000 high-reference-count galaxies, quasars, blazars, Seyfert galaxies, radio sources, and active galactic nuclei with positive redshifts. Distances are approximate flat Lambda-CDM redshift distances for atlas placement.

BASS DR2 black-hole records are loaded from `data/catalogs/bass_dr2_black_holes.json`, generated by `scripts/build_bass_dr2_black_holes_catalog.py` from the BASS DR2 VizieR table. The snapshot includes only rows with a published finite black-hole mass estimate and positive catalog distance. These are source-backed mass-bearing active-galaxy records, not a claim that the catalog is a complete census of black holes in the universe.

The eROSITA-DE DR2 (eRASS:3) X-ray catalogs are imported directly into Phoenix/Postgres with `scripts/import_erosita_dr2_catalog.py` (about 1.98 million western-Galactic-hemisphere sources: 1,911,744 point-like and 63,796 extended). The SDSS-V DR20 SPIDERS DL1 allepoch catalog (263,310 eROSITA X-ray targets with BOSS optical spectroscopy) is imported with `scripts/import_sdss_spiders_dr20_catalog.py`. Redshift-based distances use spectroscopic (SPIDERS, `sdss_zwarning = 0`) or SIMBAD-compiled (DR2 LS10 counterparts, variable reliability) redshifts; sources without a usable redshift are drawn on an explicit 1 Gly reference shell that is a display convention, never a measurement.

Curated extragalactic survey landmarks are loaded from `data/catalogs/curated_extragalactic_survey.json`, generated by `scripts/build_curated_extragalactic_survey_catalog.py`. The compact static snapshot deliberately avoids bulk survey downloads while adding source-backed Local Volume galaxies, Virgo/Fornax/Abell cluster anchors, Shapley and Great Attractor context landmarks, and famous 3C/APM/Tonantzintla quasars/blazars with NED/SIMBAD and survey-catalog provenance.

The Milky Way view layer is a procedural frontend context layer, not a catalog of individual stars. It defines the Galactic center, outer disk, solar circle, and major spiral-arm density guides in Galactic coordinates, then rotates diffuse haze, dust lanes, and reference geometry into the same heliocentric ecliptic frame used by the canvas. Real Gaia point primitives render over that context layer; the Milky Way renderer does not add fake selectable-looking stars.

Universe-scale structure is rendered only from measured catalog points. The
atlas does not draw synthetic filaments, density ridges, quasar fields, or
named cosmic-web regions. DESI DR1 galaxies and quasars provide the broad
physical point distribution; curated Messier, OpenNGC, and SIMBAD objects
remain the searchable named landmarks.

Object media is resolved in `src/objectMedia.ts`. Curated NASA Image and Video Library assets cover the Sun, major planets, Pluto, the Moon, and selected Messier objects with visible attribution. Every object with right ascension and declination gets two comparable views: a curated image when one exists (otherwise reliable all-sky DSS2 context), plus a coordinate-centered cutout from the [DESI Legacy Imaging Surveys DR11](https://www.legacysurvey.org/dr11/) map. The public DR11 cutout service can be slow or rate-limited, so a failed request is replaced in place by a reliable all-sky AllWISE infrared field from CDS/Aladin and is labeled as a fallback. DR11 combines 263,407 exposures into a 5.6-trillion-pixel optical/near-infrared map containing about 3.9 billion unique sources; its imaging footprint covers roughly 31,000 square degrees rather than the full sky. Survey imagery is angular observing context only: the atlas continues to place each object using its separately documented distance model. Objects without coordinates or curated media show an explicit catalog-only state instead of an empty media gap. See the [Berkeley Lab DR11 release](https://newscenter.lbl.gov/2026/08/10/scientists-release-biggest-2d-map-of-the-universe/).

The API exposes the scientific catalog layer:

- `/api/catalog` returns loaded object metadata without positions.
- `/api/catalog/search` searches the Phoenix/Postgres catalog index by name, aliases, object type, source group, and source facts.
- `/api/catalog/density` returns binned viewport counts for diagnostics and future server-side summary views.
- `/catalog-tiles/v1/manifest.json` and `/catalog-tiles/v1/.../*.bin` serve immutable static point tiles for bulk star rendering; production can load the same manifest and tile files from object storage/CDN.
- `/api/catalog/points` and `/api/catalog/points.bin` remain temporary development fallbacks for point rendering when static tiles are missing.
- `/api/catalog/nearest` returns the nearest catalog object to a clicked map coordinate so point-layer stars can hydrate into selectable objects.
- `/api/catalog/viewport` returns only catalog objects inside the current map bounds, so zooming hydrates visible stars, small bodies, or deep-sky objects without inflating startup.
- `/api/objects/:key` returns a Phoenix catalog object with facts, astrometry, position, source metadata, and external lookup links.
- `/api/objects/:key/external-links` returns only the source lookup links for the object, including JPL SBDB, SIMBAD, NED, or Gaia where applicable.
- `/api/ephemeris` returns the lightweight startup ephemeris by default; pass explicit `groups=` or `keys=` to hydrate broader catalog objects.
- `/api/orbits` returns parent-relative state vectors and osculating orbital elements derived from the current epoch.
- `/api/trails` returns sampled body positions around a timestamp for selected dynamic objects.

## Architecture

The Python backend is the scientific ephemeris and ingestion layer. Phoenix is
the public application and catalog API, with Postgres-backed search, object
detail, viewport hydration, and pagination. Phoenix serves the built UI and
proxies scientific calculation endpoints to Python.

See [Backend Architecture](docs/backend-architecture.md) for the service split
and [Scientific Methodology](docs/scientific-methodology.md) for coordinate,
epoch, distance, and selection conventions.

## Coordinate System

Positions are computed as heliocentric ecliptic Cartesian coordinates:

- The Sun is the origin.
- Object positions are expressed in astronomical units and kilometers.
- Parent-relative state vectors expose position in kilometers and velocity in kilometers per second.
- Orbital elements are derived from the parent-relative state vector at the current epoch.
- The canvas renders x/y from the ecliptic frame as a 2D top-down map.
- The z coordinate is retained in the data and used for distance calculations.
- The Milky Way overlay is projected into the same x/y ecliptic plane. Because the Galactic disk is tilted relative to the ecliptic, the overlay appears as a projected disk/band rather than a face-on spiral in this view.

## Visual Scaling

Distances are never numerically compressed or altered. Zoom only changes the map transform from AU to pixels.

The map has three object-size modes. `Readable` deliberately exaggerates object markers so bodies remain visible. `Hybrid` renders true radii when they are large enough at the current zoom and falls back to compact markers for sub-pixel objects. `True` uses the loaded physical radius directly, including catalog stars and Messier objects with size estimates; selected sub-pixel objects still get rings so they can be found.

At interstellar and deep-sky scale, the scale grid and labels switch to light-year-friendly values, but the underlying coordinates remain AU/km.

## Time Controls

The timestamp input is treated as UTC. Changing time recomputes every dynamic celestial body from the ephemeris source, reusing deterministic local cache entries when present. Static nearby-star and Messier catalog objects remain fixed at their catalog positions.

## Accuracy Limitations

- Planet positions come from the JPL ephemeris through Skyfield, not circular orbit approximations.
- Mars, Jupiter, Saturn, Uranus, Neptune, and Pluto use barycenter targets from the planetary ephemeris.
- Phobos and Deimos use the official NAIF MAR099s satellite SPK. The Galilean moons and included Saturn moons use NASA/JPL Horizons parent-relative vectors. Many smaller or newly cataloged satellites are still missing.
- Nearby exoplanet-host, Hipparcos bright stars, and Gaia local stars use static catalog positions. Proper motion, radial velocity, binary motion, and future/past epoch propagation are recorded where available but not applied to the rendered position yet.
- Hipparcos and Gaia star radii are rough estimates derived from catalog magnitude, parallax, and color when available. They are useful for visual comparison, not stellar modeling.
- JPL small-body positions are approximate two-body positions derived from a single SBDB osculating-element epoch. They are useful for discovery and rough map placement, not mission-grade ephemerides.
- Confirmed exoplanets are attached to their host system as catalog records. They are not rendered as independently orbiting bodies because most catalog rows do not include enough phase information for current-position ephemerides.
- Messier deep-sky objects use static catalog RA/Dec and distance estimates. Their distances and physical sizes are educational catalog values, not mission-grade astrometric solutions.
- SIMBAD extragalactic distances are redshift-derived estimates. Local peculiar velocities and cosmology assumptions can dominate nearby-galaxy placement error.
- The Milky Way layer is an oriented procedural context model. Its diffuse haze, dust lanes, core glow, and spiral-arm density guides are for spatial context, not a high-precision structural model. Catalog stars are rendered by the real Gaia point layer instead.
- Universe-scale points come from the DESI DR1 main-survey redshift catalog.
  Their radial placement is a flat-Lambda-CDM comoving-distance estimate, not
  a peculiar-velocity correction or a claim that the 2D view preserves
  line-of-sight depth.
- NGC/IC support includes the generated OpenNGC catalog described above; Messier records also retain their NGC/IC aliases where available.
- Osculating orbital elements are computed from a single instantaneous state vector. They are useful for inspection and rough comparison, but they are not permanent catalog elements or mission-grade propagated orbits.
- The map is a top-down ecliptic projection, so it does not show vertical displacement visually.
- Light travel time uses distance divided by `299,792.458 km/s`.

## License

Cosmic Atlas source code and original project materials are available under the
[MIT License](LICENSE). Third-party scientific catalog records and ephemeris
data are not relicensed under MIT; see the [scientific data notice](DATA-NOTICE.md)
and the provenance embedded in each generated catalog.
