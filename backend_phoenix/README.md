# Starsmap API

Phoenix API service for the scalable Cosmic Atlas catalog.

This service is the new catalog boundary. It should take over searchable/static catalog work first, while the existing Python backend continues to calculate ephemeris, orbits, trails, Horizons vectors, and import artifacts.

## Run

```bash
mix deps.get
mix ecto.setup
mix starsmap.import_catalogs
mix phx.server
```

## Import Catalogs

Import the generated static catalog snapshots from the repo-level `data/catalogs/` directory:

```bash
mix starsmap.import_catalogs
```

To import from another Starsmap checkout, pass its repo root:

```bash
mix starsmap.import_catalogs /path/to/starsmap
```

The dev/test config defaults to the local Postgres socket at `/var/run/postgresql` with user `postgres`. Override it with standard environment variables when needed:

```text
DATABASE_URL
TEST_DATABASE_URL
PGHOST
PGSOCKET_DIR
PGUSER
PGPASSWORD
PGDATABASE
```

## Browser Entrypoint

Phoenix can now be used as the main browser entrypoint:

- `GET /` serves `backend_phoenix/priv/static/index.html` when the built atlas UI is present.
- If the atlas has not been built into `priv/static`, Phoenix returns a clear `503` HTML message instead of a missing-route error.

This first step intentionally serves the existing client-rendered atlas from a controller. The Phoenix app was scaffolded API-only, and adding a LiveView shell is better left to a later dependency-aware slice so the browser handoff and Python scientific proxy can land without destabilizing the migration.

## Routes

- `GET /api/health`
- `GET /api/catalog`
- `GET /api/catalog/search?q=&groups=&types=&offset=&limit=`
- `GET /api/catalog/density?min_x_au=&max_x_au=&min_y_au=&max_y_au=&groups=&types=&bins=`
- `GET /api/catalog/points?min_x_au=&max_x_au=&min_y_au=&max_y_au=&groups=&types=&limit=`
- `GET /api/catalog/nearest?x_au=&y_au=&radius_au=&groups=&types=`
- `GET /api/catalog/viewport?min_x_au=&max_x_au=&min_y_au=&max_y_au=&groups=&types=&limit=`
- `GET /api/objects/:key`
- `GET /api/ephemeris`
- `GET /api/orbits`
- `GET /api/trails`

The scientific endpoints are proxied to the existing Python backend. By default Phoenix forwards them to `http://127.0.0.1:8765`; override that with:

```text
PYTHON_BACKEND_URL=http://127.0.0.1:8765
```

## Boundary

Phoenix owns:

- Postgres-backed catalog search and pagination.
- Object detail lookup and source provenance.
- Viewport-bounds queries for progressive canvas loading.
- Future media, user/session, and cache/API concerns.

Python owns:

- Skyfield/SPICE/Horizons position calculation.
- Scientific import scripts and generated catalog snapshots.
- Ephemeris, orbit, and trail calculations until those are deliberately moved or wrapped.
