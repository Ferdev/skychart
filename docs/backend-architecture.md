# Backend Architecture

Cosmic Atlas should scale like a scientific catalog application, not like a single JSON document served to the browser.

The target backend is split into two responsibilities:

- Phoenix owns the product API: catalog search, object detail, viewport queries, pagination, API contracts, caching, and eventually user/session features.
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
  -> Phoenix /api/catalog/search
  -> Phoenix /api/catalog/viewport
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

This table is not the final scientific truth for every object type. It is the fast lookup surface for the UI. Source-specific tables can be added behind it when Gaia, SIMBAD, NED, JPL small bodies, and detailed exoplanet records need richer schemas.

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

## Migration Order

1. Keep the Python API stable for ephemeris, orbits, trails, and temporary catalog endpoints.
2. Import static catalog projections into Phoenix/Postgres.
3. Point Explore and Compare search to Phoenix.
4. Add viewport tile loading so the canvas only hydrates visible static objects.
5. Move object detail/media lookup to Phoenix.
6. Let Python become a worker/pipeline layer rather than the browser-facing catalog API.

This lets the app grow from tens of thousands of objects to hundreds of thousands, then millions, without changing the core UI contract each time a catalog source is added.
