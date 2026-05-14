# Backend Architecture

Cosmic Atlas should scale like a scientific catalog application, not like a single JSON document served to the browser.

The target backend is split into three responsibilities:

- Phoenix owns the product API: catalog search, object detail, nearest-object lookup, viewport object hydration, pagination, API contracts, caching, and eventually user/session features.
- Static tile artifacts own bulk point visualization: immutable binary tile pyramids served from `/catalog-tiles/...` locally and from object storage/CDN in production.
- Python owns scientific data work: Skyfield/SPICE ephemerides, Horizons adapters, Astropy-style conversions, and offline catalog ingestion jobs.

## Why Split It

The current Python server is good at calculating precise positions, but the frontend should not download every star, exoplanet host, galaxy, quasar, asteroid, comet, or black-hole candidate before the user can search. At Starry Night scale, most interactions should ask for a small page of relevant objects:

- text search: `Sirius`, `M31`, `TRAPPIST-1`, `quasar`
- faceted browsing: stars, galaxies, exoplanet systems, Solar System objects
- viewport loading: objects inside the current map bounds and zoom level
- detail hydration: one selected object with full source metadata and rich facts
- ephemeris hydration: a small set of dynamic objects for a timestamp

## Service Boundary

```text
Vite frontend / canvas
  -> Static/CDN /catalog-tiles/v1/manifest.json
  -> Static/CDN /catalog-tiles/v1/s{span_log2}/x{x}/y{y}.bin
  -> Phoenix /api/catalog/search
  -> Phoenix /api/catalog/viewport
  -> Phoenix /api/catalog/nearest
  -> Phoenix /api/objects/:key
  -> Python /api/ephemeris?keys=earth,mars,jupiter
  -> Python /api/orbits and /api/trails while those remain scientific calculators

Phoenix
  -> Postgres catalog_objects and future source-specific tables
  -> cached object-detail projections
  -> background import jobs

Python
  -> Skyfield/SPICE/Horizons
  -> generated catalog snapshots
  -> offline import artifacts consumed by Phoenix

Offline tile compiler
  -> Postgres catalog_objects or future source-specific tables
  -> versioned static binary tile pyramid
  -> manifest with projection, format, levels, and source counts
```

Phoenix and Python can coexist during migration. The frontend can keep using the Python server for current ephemeris endpoints while search/detail routes move to Phoenix.

## Catalog Table

The first Phoenix migration creates `catalog_objects` as the common searchable projection. It intentionally stores normalized fields plus flexible JSON facts:

- stable identity: `key`, `name`, `aliases`, `external_ids`
- classification: `object_type`, `catalog_group`, `source_type`, `position_model`
- astrometry: `ra_deg`, `dec_deg`, `distance_pc`, `distance_ly`, magnitudes
- map projection: `x_au`, `y_au`, `z_au`, plus kilometer equivalents
- rendering: `color`, `radius_km`
- search: denormalized `search_text` with a trigram GIN index
- provenance and detail: `source` and `facts` maps

This table is not the final scientific truth for every object type. It is the fast lookup surface for the UI and the current source for offline visualization tiles. Source-specific tables can be added behind it when Gaia, SIMBAD, NED, JPL small bodies, and detailed exoplanet records need richer schemas.

## Static Point Tiles

Bulk point rendering should work like GIS/map applications such as Carto:

- The browser chooses visible tile coordinates from the camera and zoom level.
- Phoenix serves local tile files from `priv/static/catalog-tiles`; production can inject a CDN manifest URL and load tile files directly from object storage/CDN.
- Postgres is not queried while the user pans or zooms.
- Search, selected-object detail, compare, and hit-testing remain API calls because those workflows need semantic object records, not anonymous drawing primitives.

The current tile format is `SMP2`, the same compact binary shape used by the transitional dynamic endpoint:

- 4 byte magic: `SMP2`
- 4 byte little-endian unsigned point count
- repeated 12 byte records: `float32 x_au`, `float32 y_au`, `uint8 r`, `uint8 g`, `uint8 b`, `uint8 reserved`

The local manifest lives at `/catalog-tiles/v1/manifest.json`; production can point the HTML at a CDN-hosted manifest with `CATALOG_TILE_MANIFEST_URL`. The manifest records the projection, tile levels, sampling policy, source catalog counts, and public tile URL template used to load the pyramid. The frontend treats `/api/catalog/points.bin` as a development fallback only when the manifest is missing. Production should have a manifest, so normal navigation should create static/CDN file requests rather than database work.

## Import Validation

Phoenix imports still write to the shared `catalog_objects` table, but the importer now emits an import report before upserting rows. The report is a narrow scale-safety primitive for future source-specific table work:

- total rows, object-type counts, catalog-group counts, and source-type counts
- per-source row counts with the source snapshot catalog names seen in row provenance
- duplicate stable-key counts and capped duplicate-key samples
- missing name, source-type, projected map-coordinate, and RA/Dec counts

The report does not change the public object payload. It gives import jobs a cheap way to fail or warn on source quality regressions before larger Gaia, SIMBAD, NED, JPL, or exoplanet snapshots are promoted into the shared searchable projection.

## API Contract

Initial Phoenix routes:

- `GET /api/health`
- `GET /api/catalog`
- `GET /api/catalog/search?q=&groups=&types=&offset=&limit=`
- `GET /api/catalog/viewport?min_x_au=&max_x_au=&min_y_au=&max_y_au=&groups=&types=&limit=`
- `GET /api/objects/:key`

The response shape is deliberately close to the existing frontend `Body.catalog` payload, but without requiring a dynamic position or orbit for every object.

`GET /api/catalog/points.bin` exists during migration as a compatibility fallback. It should not be part of the production pan/zoom path once static tiles are generated.

## Migration Order

1. Keep the Python API stable for ephemeris, orbits, trails, and temporary catalog endpoints.
2. Import static catalog projections into Phoenix/Postgres.
3. Point Explore and Compare search to Phoenix.
4. Add viewport tile loading so the canvas only hydrates visible static objects.
5. Move object detail/media lookup to Phoenix.
6. Generate a static point-tile pyramid after imports and switch the frontend to static tile URLs for bulk visualization.
7. Remove dynamic point-tile queries from the production path and keep Postgres for semantic lookup APIs.
8. Let Python become a worker/pipeline layer rather than the browser-facing catalog API.

This lets the app grow from tens of thousands of objects to hundreds of thousands, then millions, without changing the core UI contract each time a catalog source is added.
