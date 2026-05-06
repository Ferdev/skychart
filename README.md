# Cosmic Atlas

An ultra-basic 2D top-down Solar System navigation MVP. It renders the current Solar System layout from live ephemeris data and lets you pilot a small arcade-style spacecraft in the same heliocentric coordinate space.

## What Is Included

- Sun, Mercury, Venus, Earth, Moon, Mars, Phobos, Deimos, Jupiter, Io, Europa, Ganymede, Callisto, Saturn, Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Iapetus, Uranus, Neptune, and Pluto.
- Real current-date body positions from Skyfield using NASA/JPL DE440s, the NAIF Mars satellite SPK, and NASA/JPL Horizons vectors for Jupiter and Saturn moons.
- Catalog-first object metadata for each loaded body: object type, parent body, source kernel, catalog group, and dynamic/static position model.
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
- Basic ship controls: `W` thrust, `S` reverse thrust, `A`/`D` rotate, `Space` toggle warp.
- Mouse wheel zoom, pointer drag pan, and simple center buttons.
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

The API now exposes a catalog layer:

- `/api/catalog` returns loaded object metadata without positions.
- `/api/ephemeris` returns the same catalog metadata alongside current positions.
- `/api/orbits` returns parent-relative state vectors and osculating orbital elements derived from the current epoch.
- Catalog groups are explicit (`core`, `mars_moons`, `jupiter_major_moons`, `saturn_major_moons`) so future object slices can be loaded by group instead of becoming another hardcoded UI list.

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

Planet and Moon display radii are deliberately exaggerated so bodies remain visible. AU rings are distance guides, not generated orbit paths.

## Time Controls

The timestamp input is treated as UTC. Changing time recomputes every celestial body from the ephemeris source. The spacecraft remains in the same heliocentric coordinate space until you reset or restart the journey.

## Accuracy Limitations

- Planet positions come from the JPL ephemeris through Skyfield, not circular orbit approximations.
- Mars, Jupiter, Saturn, Uranus, Neptune, and Pluto use barycenter targets from the planetary ephemeris.
- Phobos and Deimos use the official NAIF MAR099s satellite SPK. The Galilean moons and included Saturn moons use NASA/JPL Horizons parent-relative vectors. Many smaller or newly cataloged satellites are still missing.
- The app now has catalog group metadata, but the frontend still loads all default Solar System groups at startup. True viewport/lazy catalog streaming is a future scaling step.
- Osculating orbital elements are computed from a single instantaneous state vector. They are useful for inspection and rough comparison, but they are not permanent catalog elements or mission-grade propagated orbits.
- Gravity-assist plans are patched-conic planning estimates. They use real ephemeris positions and velocities, but they are not full Lambert/n-body mission optimizations.
- Flyby feasibility is estimated from idealized turn angle, periapsis altitude, and incoming/outgoing excess velocity. It does not include launch vehicle constraints, finite burns, perturbations, or navigation margins.
- The map is a top-down ecliptic projection, so it does not show vertical displacement visually.
- The spacecraft movement is fictional arcade motion. It is integrated in the same heliocentric AU coordinate space, but it is not orbital mechanics.
- Ship-to-target distance includes the target body's retained ecliptic z coordinate while the ship stays in its starting z plane.
- Light travel time uses distance divided by `299,792.458 km/s`.
