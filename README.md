# Cosmic Atlas

Cosmic Atlas is a scientific 2D celestial atlas. It renders Solar System bodies, nearby exoplanet-host stars, and Messier deep-sky objects in one heliocentric ecliptic coordinate space so they can be searched, inspected, centered, measured, and compared.

## What Is Included

- Sun, planets, Earth's Moon, Mars moons, major Jupiter and Saturn moons, Pluto, a nearby exoplanet-host star slice, and the full generated Messier catalog snapshot.
- Real current-date Solar System body positions from Skyfield using NASA/JPL DE440s, the NAIF Mars satellite SPK, and NASA/JPL Horizons vectors for major Jupiter and Saturn moons.
- Static nearby exoplanet-host star positions projected from NASA Exoplanet Archive right ascension, declination, and distance.
- Static Messier deep-sky positions projected from catalog right ascension, declination, and distance estimates, with NGC/IC aliases where listed.
- Catalog metadata for each loaded object: object type, parent body, source kernel or catalog source, catalog group, and dynamic/static position model.
- Object inspection for physical radius, Earth distance, heliocentric distance, state-vector speeds, osculating orbital elements, stellar data, and deep-sky observing metadata.
- Distance measurement between selected objects or map points, including light-time and scale comparisons.
- UTC time controls: apply a timestamp, jump to now, or step by days/weeks/months.
- Map view controls for object labels, orbit guides, scale grid, edge references, zoom presets, and readable/hybrid/true-size rendering.
- Guided object sets for Solar neighborhood, nearby stars, Messier highlights, galaxies, and nebulae.
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

Start both the ephemeris API and Vite:

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

You can also run the two processes separately:

```bash
.venv/bin/python backend/server.py
npm run dev
```

## Data Source

The backend uses [Skyfield](https://rhodesmill.org/skyfield/) with the NASA/JPL `de440s.bsp` planetary ephemeris kernel. It also loads the NAIF `mar099s.bsp` satellite SPK for Mars' moons. Jupiter and Saturn major moons are fetched from the NASA/JPL Horizons API as parent-relative vectors and then placed into the same heliocentric ecliptic coordinate space as the Skyfield bodies.

Nearby exoplanet-host stars are a curated static slice from the NASA Exoplanet Archive. Their catalog right ascension, declination, and distance are converted into heliocentric ecliptic Cartesian coordinates. These stars are not JPL-propagated dynamic ephemeris bodies.

Messier objects are loaded from a generated snapshot in `data/catalogs/deep_sky_catalog.json`. The generator script `scripts/build_deep_sky_catalog.py` pulls the AstroPixels Messier table for RA/Dec, distance estimates, apparent magnitude, angular size, constellation, season, and common names, and records NASA HEASARC Messier table notes as catalog context. When angular size and distance are available, the backend derives an estimated physical diameter for true-size rendering.

The API exposes the scientific catalog layer:

- `/api/catalog` returns loaded object metadata without positions.
- `/api/ephemeris` returns catalog metadata with current positions.
- `/api/orbits` returns parent-relative state vectors and osculating orbital elements derived from the current epoch.
- `/api/trails` returns sampled body positions around a timestamp for selected dynamic objects.

## Coordinate System

Positions are computed as heliocentric ecliptic Cartesian coordinates:

- The Sun is the origin.
- Object positions are expressed in astronomical units and kilometers.
- Parent-relative state vectors expose position in kilometers and velocity in kilometers per second.
- Orbital elements are derived from the parent-relative state vector at the current epoch.
- The canvas renders x/y from the ecliptic frame as a 2D top-down map.
- The z coordinate is retained in the data and used for distance calculations.

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
- Nearby exoplanet-host stars use static NASA Exoplanet Archive catalog positions. Proper motion, radial velocity, binary motion, and future/past epoch propagation are not implemented yet.
- Messier deep-sky objects use static catalog RA/Dec and distance estimates. Their distances and physical sizes are educational catalog values, not mission-grade astrometric solutions.
- NGC/IC support currently comes through aliases attached to Messier objects, not the full NGC/IC catalog.
- Osculating orbital elements are computed from a single instantaneous state vector. They are useful for inspection and rough comparison, but they are not permanent catalog elements or mission-grade propagated orbits.
- The map is a top-down ecliptic projection, so it does not show vertical displacement visually.
- Light travel time uses distance divided by `299,792.458 km/s`.
