# Cosmic Atlas

Cosmic Atlas is a scientific 2D celestial atlas. It renders Solar System bodies, confirmed exoplanet host systems, Hipparcos bright stars, Gaia local-neighborhood stars, JPL small bodies, SIMBAD extragalactic objects, nearby stars, and Messier deep-sky objects in one heliocentric ecliptic coordinate space so they can be searched, inspected, centered, measured, and compared.

## What Is Included

- Sun, planets, Earth's Moon, Mars moons, major Jupiter and Saturn moons, Pluto, a nearby exoplanet-host star slice, a generated NASA Exoplanet Archive host-system snapshot, a generated Hipparcos bright-star slice, a generated ESA Gaia DR3 local-neighborhood slice, a generated NASA/JPL Small-Body Database slice, a generated SIMBAD extragalactic slice, and the full generated Messier catalog snapshot.
- Real current-date Solar System body positions from Skyfield using NASA/JPL DE440s, the NAIF Mars satellite SPK, and NASA/JPL Horizons vectors for major Jupiter and Saturn moons.
- Static confirmed exoplanet host-system positions projected from NASA Exoplanet Archive right ascension, declination, and distance, with confirmed planet lists attached to each host.
- Static Hipparcos bright-star positions projected from right ascension, declination, and parallax-derived distance, with apparent magnitude, color index, spectral type, and estimated stellar radius when enough catalog data is present.
- Static Gaia DR3 local-neighborhood star positions projected from right ascension, declination, and parallax-derived distance, with Gaia G magnitude, BP-RP color, proper-motion facts, and estimated stellar radius when enough catalog data is present.
- JPL Small-Body Database asteroids and comets propagated from osculating elements into approximate heliocentric ecliptic positions for search, viewport loading, and comparison.
- Static Messier deep-sky positions projected from catalog right ascension, declination, and distance estimates, with NGC/IC aliases where listed.
- SIMBAD galaxies, quasars, and active galactic nuclei projected from RA/Dec and redshift-derived distance estimates, with SIMBAD and NED lookup links attached.
- Catalog metadata for each loaded object: object type, parent body, source kernel or catalog source, catalog group, and dynamic/static position model.
- Object inspection for physical radius, Earth distance, heliocentric distance, state-vector speeds, osculating orbital elements, stellar data, and deep-sky observing metadata.
- Curated NASA/JPL and NASA/Hubble media for selected high-value objects, with title, credit, license, and source link shown directly in object detail.
- Distance measurement between selected objects or map points, including light-time and scale comparisons.
- UTC time controls: apply a timestamp, jump to now, or step by days/weeks/months.
- Map view controls for object labels, orbit guides, scale grid, Milky Way projection, edge references, zoom presets, and readable/hybrid/true-size rendering.
- Guided object sets for Solar neighborhood, bright stars, nearby stars, small bodies, Messier highlights, galaxies, active galaxies, and nebulae.
- A scale ladder that marks whether the current viewport is planetary, Solar System, nearby-star, Milky Way, or Local Group scale.

The old piloting/game prototype has been split out to the `game/ship-prototype` branch.

## Install

Standard Python environment:

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m ensurepip
.venv/bin/python -m pip install -r requirements.txt
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

In `pc-ferdev`, enable `starsmap-python` and then `starsmap-phoenix`; Phoenix serves the browser app and proxies live scientific endpoints to Python.

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

## Production Catalog Import

The checked-in JSON catalogs and the multi-million-row Gaia slices are imported through different paths. Use the wrapper below after deploys and whenever production looks under-populated:

```bash
scripts/import_catalogs_if_needed.sh
```

The wrapper runs migrations, imports the checked-in catalog snapshots, then checks the two large Gaia catalog groups before deciding whether to stream them from Gaia TAP into Postgres:

- `gaia_500pc_stars`, expected minimum `1,597,012` rows from the current Gaia TAP sync import.
- `gaia_10kpc_bright_stars`, expected minimum `1,339,910` rows from the current Gaia TAP sync import.

It is safe to run repeatedly. Existing complete Gaia slices are skipped by row-count threshold.

When the app is deployed with Kamal, the same check is wired as a post-deploy hook:

```bash
kamal app exec -d production --primary --env MIX_ENV:prod --env CATALOG_IMPORT_SUMMARY:0 -- ./scripts/import_catalogs_if_needed.sh
```

The Gaia importer accepts either standard `PG*` environment variables or `DATABASE_URL` for its `psql` connection.
Production uses an `ecto://` `DATABASE_URL`; the importer converts that to a PostgreSQL URL for `psql`.

Static point tiles are built separately from normal deploys. Production should use the manual `Build Production Catalog Tiles` GitHub workflow after the image is deployed; that workflow builds the `/catalog-tiles/v1` pyramid inside the production app container with low CPU priority and uploads it to the configured S3-compatible bucket/CDN. Normal deploys only inject `CATALOG_TILE_MANIFEST_URL` into the HTML so the browser can load the CDN manifest and immutable `.bin` tile files.

## Data Source

The backend uses [Skyfield](https://rhodesmill.org/skyfield/) with the NASA/JPL `de440s.bsp` planetary ephemeris kernel. It also loads the NAIF `mar099s.bsp` satellite SPK for Mars' moons. Jupiter and Saturn major moons are fetched from the NASA/JPL Horizons API as parent-relative vectors and then placed into the same heliocentric ecliptic coordinate space as the Skyfield bodies.

Nearby exoplanet-host stars are a curated static slice from the NASA Exoplanet Archive. The broader exoplanet-system catalog comes from `data/catalogs/exoplanet_systems.json`, generated by `scripts/build_exoplanet_catalog.py` from the NASA Exoplanet Archive Planetary Systems Composite Parameters table. Host-system right ascension, declination, and distance are converted into heliocentric ecliptic Cartesian coordinates, and confirmed planets are shown as catalog facts on the host object. These stars and exoplanet systems are not JPL-propagated dynamic ephemeris bodies.

Bright stars are loaded from `data/catalogs/bright_stars.json`, generated by `scripts/build_bright_star_catalog.py` from the CDS/VizieR Hipparcos Main Catalogue. The snapshot includes stars with V magnitude `< 6.5` and positive parallax. The backend skips entries that duplicate already-loaded exoplanet host systems by name or alias.

Gaia local stars are loaded from `data/catalogs/gaia_local_stars.json`, generated by `scripts/build_gaia_local_catalog.py` from the ESA Gaia DR3 `gaiadr3.gaia_source` table. The default snapshot includes 33,170 nearby sources with parallax `>= 20 mas`, parallax-over-error `>= 10`, and Gaia G magnitude `<= 16`.

The larger Gaia point layers are imported directly into Phoenix/Postgres with `scripts/import_gaia_bulk_catalog.py --preset 500pc-g14` and `scripts/import_gaia_bulk_catalog.py --preset 10kpc-g12`. The current bulk slices add 3,016,638 Gaia DR3 sources between 50 and 500 pc and 1,928,481 broader bright Gaia DR3 sources between 500 pc and 10 kpc, without creating multi-gigabyte JSON snapshots or increasing the app startup payload.

Small bodies are loaded from `data/catalogs/small_bodies.json`, generated by `scripts/build_small_body_catalog.py` from the NASA/JPL Small-Body Database Query API. The current snapshot imports 17,630 large diameter-known asteroids, bright near-Earth asteroids, and non-fragment comets. Positions are approximate two-body propagations from SBDB osculating elements to the snapshot generation timestamp, not full N-body ephemerides.

Messier objects are loaded from a generated snapshot in `data/catalogs/deep_sky_catalog.json`. The generator script `scripts/build_deep_sky_catalog.py` pulls the AstroPixels Messier table for RA/Dec, distance estimates, apparent magnitude, angular size, constellation, season, and common names, and records NASA HEASARC Messier table notes as catalog context. When angular size and distance are available, the backend derives an estimated physical diameter for true-size rendering.

SIMBAD extragalactic objects are loaded from `data/catalogs/simbad_extragalactic.json`, generated by `scripts/build_simbad_extragalactic_catalog.py` from the SIMBAD TAP `basic` table. The current snapshot imports 5,000 high-reference-count galaxies, quasars, blazars, Seyfert galaxies, radio sources, and active galactic nuclei with positive redshifts. Distances are approximate flat Lambda-CDM redshift distances for atlas placement.

The Milky Way view layer is a procedural frontend context layer, not a catalog of individual stars. It defines the Galactic center, outer disk, solar circle, and major spiral-arm density guides in Galactic coordinates, then rotates diffuse haze, dust lanes, and reference geometry into the same heliocentric ecliptic frame used by the canvas. Real Gaia point primitives render over that context layer; the Milky Way renderer does not add fake selectable-looking stars.

Object media is resolved in `src/objectMedia.ts`. Curated NASA Image and Video Library assets cover the Sun, major planets, Pluto, the Moon, M31, M42, M45, and M57 with visible attribution. Objects with right ascension and declination but no curated image use a deterministic CDS/Aladin DSS2 survey cutout, so searched catalog objects can still show real sky imagery without live media search. Objects without either source show an explicit catalog-only state instead of an empty media gap.

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

## Backend Direction

The Python backend remains the scientific ephemeris and ingestion layer. A Phoenix API now lives in `backend_phoenix/` for the catalog service we need at Starry Night scale: Postgres-backed search, object detail hydration, viewport-bounds queries, pagination, and future source-specific catalog tables. Phoenix can also serve the built atlas UI at `/`, while `/api/ephemeris`, `/api/orbits`, and `/api/trails` are proxied to Python.

See `docs/backend-architecture.md` for the target split between Phoenix and Python.

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
- NGC/IC support currently comes through aliases attached to Messier objects, not the full NGC/IC catalog.
- Osculating orbital elements are computed from a single instantaneous state vector. They are useful for inspection and rough comparison, but they are not permanent catalog elements or mission-grade propagated orbits.
- The map is a top-down ecliptic projection, so it does not show vertical displacement visually.
- Light travel time uses distance divided by `299,792.458 km/s`.
