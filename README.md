# Cosmic Atlas

An ultra-basic 2D top-down Solar System navigation MVP. It renders the current Solar System layout from live ephemeris data and lets you pilot a small arcade-style spacecraft in the same heliocentric coordinate space.

## What Is Included

- Sun, Mercury, Venus, Earth, Moon, Mars, Phobos, Deimos, Jupiter, Io, Europa, Ganymede, Callisto, Saturn, Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Iapetus, Uranus, Neptune, Pluto, a first nearby exoplanet-host star slice, and the full Messier deep-sky catalog.
- Real current-date Solar System body positions from Skyfield using NASA/JPL DE440s, the NAIF Mars satellite SPK, and NASA/JPL Horizons vectors for Jupiter and Saturn moons.
- Static nearby exoplanet-host star positions projected from NASA Exoplanet Archive right ascension, declination, and distance.
- Static Messier deep-sky positions projected from catalog right ascension, declination, and distance estimates, with NGC/IC aliases where listed.
- Catalog-first object metadata for each loaded body: object type, parent body, source kernel, catalog group, and dynamic/static position model.
- Top-down osculating orbit overlays drawn from the current parent-relative state vectors.
- 2D top-down canvas map using heliocentric ecliptic x/y coordinates.
- Quick target shortcuts for Moon, Mars, Jupiter, and Saturn.
- Destination search for targeting and jumping to any loaded body.
- Inspect and center on any rendered body.
- Set any inspected body as the current navigation target.
- UTC time controls: apply a timestamp, jump to now, or step by days/weeks/months.
- Real Earth-to-target distance, ship-to-target distance, light travel time, zoom scale, and a journey progress panel.
- Navigation feedback: target heading arrow, closing speed, ETA, closest approach, and arrival status.
- Gravity-assist planning panel with direct-transfer and single-flyby patched-conic candidate comparisons.
- Launch-window scanning using real JPL ephemeris states at departure, flyby, and arrival events.
- Basic ship controls: `W` thrust, `S` reverse thrust, `A`/`D` rotate, `Space` toggle warp. Thrust also drives an invisible z-axis component toward the selected target so top-down travel still closes true 3D distance.
- Mouse wheel zoom, pointer drag pan, and simple center buttons.
- Viewport-side nearest-object references that update while panning and show each off-screen body's glyph, name, and distance from the current map center.
- Guided tours for Messier highlights, galaxies, nebulae, star clusters, nearby stars, and Local Group scale objects.
- A scale ladder showing whether the current viewport is planetary, Solar System, nearby-star, Milky Way, Local Group, or deep-sky scale.
- Deep-sky object details: apparent magnitude, angular size, constellation, viewing season, recommended observing equipment, and lookback time.
- Reset controls for placing the ship back near Earth and restarting the current journey.

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

The first backend request downloads the required kernels into `data/skyfield/`, so first launch can take a moment:

- `de440s.bsp` for the Sun, planets, Earth's Moon, and Pluto barycenter.
- `mar099s.bsp` for Phobos and Deimos.

The first Jupiter/Saturn moon positions are fetched from the NASA/JPL Horizons API rather than downloaded as very large local kernels.

You can also run the two processes separately:

```bash
.venv/bin/python backend/server.py
npm run dev
```

## Data Source

The backend uses [Skyfield](https://rhodesmill.org/skyfield/) with the NASA/JPL `de440s.bsp` planetary ephemeris kernel. It also loads the NAIF `mar099s.bsp` satellite SPK for Mars' moons. Jupiter and Saturn major moons are fetched from the NASA/JPL Horizons API as parent-relative vectors and then placed into the same heliocentric ecliptic coordinate space as the Skyfield bodies.

Nearby exoplanet-host stars are a curated static slice from the NASA Exoplanet Archive. Their catalog right ascension, declination, and distance are converted into heliocentric ecliptic Cartesian coordinates so they can be searched, targeted, centered, measured, and rendered in the same map coordinate space. These stars are not JPL-propagated dynamic ephemeris bodies.

Messier objects are loaded from a generated snapshot in `data/catalogs/deep_sky_catalog.json`. The generator script `scripts/build_deep_sky_catalog.py` pulls the AstroPixels Messier table for RA/Dec, distance estimates, apparent magnitude, angular size, constellation, season, and common names, and records NASA HEASARC Messier table notes as catalog context. Distance-known Messier entries are targetable and measured with the same x/y/z distance math, but they remain static catalog positions rather than propagated ephemerides.

The API now exposes a catalog layer:

- `/api/catalog` returns loaded object metadata without positions.
- `/api/ephemeris` returns the same catalog metadata alongside current positions.
- `/api/orbits` returns parent-relative state vectors and osculating orbital elements derived from the current epoch.
- Catalog groups are explicit (`core`, `mars_moons`, `jupiter_major_moons`, `saturn_major_moons`, `nearby_exoplanet_systems`, `messier_deep_sky`) so future object slices can be loaded by group instead of becoming another hardcoded UI list.

## Coordinate System

Positions are computed as heliocentric ecliptic Cartesian coordinates:

- The Sun is the origin.
- Body positions are expressed in astronomical units and kilometers.
- Parent-relative state vectors expose position in kilometers and velocity in kilometers per second.
- Orbital elements are derived from the parent-relative state vector at the current epoch.
- The canvas renders x/y from the ecliptic frame as a 2D top-down map.
- The z coordinate is retained in the data and used for distance calculations.

## Visual Scaling

Distances are never numerically compressed or altered. Zoom only changes the map transform from AU to pixels.

Planet, Moon, and star display radii are deliberately exaggerated so bodies remain visible. The Orbits layer draws current osculating orbit references from the epoch state vectors; these are visual guides, not n-body propagated paths. At interstellar scale the grid and HUD switch to light-year-friendly labels, but the underlying coordinates remain AU/km.

## Time Controls

The timestamp input is treated as UTC. Changing time recomputes every celestial body from the ephemeris source. The spacecraft remains in the same heliocentric coordinate space until you reset or restart the journey.

## Accuracy Limitations

- Planet positions come from the JPL ephemeris through Skyfield, not circular orbit approximations.
- Mars, Jupiter, Saturn, Uranus, Neptune, and Pluto use barycenter targets from the planetary ephemeris.
- Phobos and Deimos use the official NAIF MAR099s satellite SPK. The Galilean moons and included Saturn moons use NASA/JPL Horizons parent-relative vectors. Many smaller or newly cataloged satellites are still missing.
- Nearby exoplanet-host stars use static NASA Exoplanet Archive catalog positions. Proper motion, radial velocity, binary motion, and future/past epoch propagation are not implemented yet.
- Messier deep-sky objects use static catalog RA/Dec and distance estimates. Their distances are educational catalog values, not mission-grade astrometric solutions. Proper motion, expansion, radial velocity, and catalog uncertainty propagation are not implemented.
- NGC/IC support currently comes through aliases attached to Messier objects, not the full NGC/IC catalog. Objects without reliable distances are intentionally not placed at fake depths.
- The app now has catalog group metadata, but the frontend still loads all default Solar System groups at startup. True viewport/lazy catalog streaming is a future scaling step.
- Interstellar and deep-sky targets can be selected and measured, but the route planner is intentionally disabled for static catalog targets until there is a credible non-Solar-System navigation model.
- Osculating orbital elements are computed from a single instantaneous state vector. They are useful for inspection and rough comparison, but they are not permanent catalog elements or mission-grade propagated orbits.
- Gravity-assist plans are patched-conic planning estimates. They use real ephemeris positions and velocities, but they are not full Lambert/n-body mission optimizations.
- Flyby feasibility is estimated from idealized turn angle, periapsis altitude, and incoming/outgoing excess velocity. It does not include launch vehicle constraints, finite burns, perturbations, or navigation margins.
- The map is a top-down ecliptic projection, so it does not show vertical displacement visually.
- The spacecraft movement is fictional arcade motion. It is integrated in the same heliocentric AU coordinate space, but it is not orbital mechanics.
- Ship-to-target distance and speed use x/y/z. The map renders x/y only, so the HUD includes a depth offset for the hidden ecliptic z component.
- Light travel time uses distance divided by `299,792.458 km/s`.
