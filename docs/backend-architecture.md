# Backend Architecture

Cosmic Atlas separates interactive catalog queries, scientific computation,
and bulk visualization so each workload can scale independently.

## Runtime services

```text
Browser
  -> Phoenix HTML and JSON APIs
  -> immutable catalog tiles from object storage/CDN

Phoenix
  -> Postgres for search, detail, analytics, and current events
  -> Python for ephemeris, orbit, trail, and observation calculations

Offline data tools
  -> normalized catalog snapshots and Postgres imports
  -> versioned SMP3/SMPK1 tile manifests and containers
```

Phoenix is the public application boundary. The Python service is bound inside
the application container and is reached through Phoenix proxy endpoints.
Kamal proxy is the only public ingress in the maintained deployment.

## Phoenix and Postgres

Phoenix owns narrow semantic workflows:

- catalog search, filtering, and pagination;
- object detail, provenance, aliases, and external identifiers;
- nearest-object and viewport hydration;
- anonymous product analytics;
- current sky-event storage and feeds;
- server-rendered public pages and metadata.

`catalog_objects` is the common searchable projection. It stores stable keys,
classification, astrometry, projected coordinates, rendering metadata,
search text, provenance, and flexible source facts. Source-specific tables
retain richer native fields where a catalog cannot be represented faithfully
by the common projection.

Postgres is not the hot rendering path for dense layers. It serves object
meaning; immutable binary artifacts serve point visualization.

## Python scientific service

The Python service handles calculations and ingestion tasks that benefit from
the scientific Python ecosystem:

- Skyfield and SPICE ephemerides;
- JPL Horizons adapters;
- orbital state and trail generation;
- coordinate and cosmology transformations;
- offline source normalization and validation.

The browser-facing endpoints are proxied through Phoenix, including
`/api/ephemeris`, `/api/orbits`, `/api/trails`, and `/api/observe`.

## Static catalog tiles

Dense point layers are compiled offline into versioned manifests and binary
tile containers. The browser chooses visible tiles from the camera bounds,
fetches byte ranges from object storage or a CDN, and decodes them in a Web
Worker. This keeps pan and zoom independent of database size.

See [Catalog Tile Format](tile-format.md) for the SMP3 and SMPK1 contracts.

## Main API surface

- `GET /api/health`
- `GET /api/catalog/search`
- `GET /api/catalog/viewport`
- `GET /api/catalog/nearest`
- `GET /api/objects/:key`
- `GET /api/ephemeris`
- `GET /api/orbits`
- `GET /api/trails`
- `GET /api/observe`
- `GET /api/now`
- `GET /feed.xml`

Development-only dynamic point endpoints remain available as a fallback when
no static manifest is configured. Maintained staging and production builds use
the immutable manifest path.

## Data flow

1. Source-specific builders download or read a documented catalog release.
2. Builders normalize identifiers, evidence types, coordinates, epochs, and
   provenance into checked snapshots or import streams.
3. Import validation reports missing fields, duplicates, source counts, and
   classification counts before rows are promoted.
4. Phoenix imports the searchable semantic projection into Postgres.
5. Offline tile builders compile render rows into immutable artifacts.
6. A verified manifest URL selects the active artifact without coupling an app
   deployment to an expensive tile rebuild.

Scientific conventions used by these pipelines are summarized in
[Scientific Methodology](scientific-methodology.md).
