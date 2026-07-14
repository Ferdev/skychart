# Cosmic Atlas Domain

Cosmic Atlas is a scientific, heliocentric ecliptic map. It combines dynamic
ephemerides, searchable catalog meaning, and immutable bulk point
visualization without pretending that those data sources have the same
precision or lifecycle.

## Domain language

### Atlas view

The complete user-visible map state: camera position and scale, UTC time,
displayed layers, active object filters, selected object, comparison target,
and optional guided tour step.

### Catalog object

A named celestial object with stable identity, classification, provenance,
scientific facts, and optional physical position. Catalog objects are suitable
for search, inspection, selection, and public object pages.

### Catalog point layer

A dense visual projection of measured catalog rows. A point can be rendered
before its full catalog object meaning is hydrated.

### Catalog tile

An immutable spatial slice of a catalog point layer, addressed through a
versioned manifest and decoded from the SMP3/SMPK1 formats.

### Catalog point streaming

The browser workflow that selects visible catalog tiles, fetches byte ranges,
decodes point records, caches results, retries failures, prefetches nearby
tiles, and supplies renderable point layers.

### Catalog point selection

The browser workflow that turns a clicked catalog point into a selected
catalog object. It owns optimistic previews, cancellation, nearest-object
fallbacks, and source-specific hydration.

### Destination discovery

The browser workflow for finding an object to inspect or compare. It combines
local and remote search, filters, pagination, recency, ranking, and keyboard
navigation.

### Object inspection

The presentation of one catalog object's scientific meaning: identifiers,
coordinates, physical facts, uncertainty, provenance, media, citations,
related objects, and observation context.

### Scientific calculation

The Python-owned computation of observations, dynamic ephemerides, state
vectors, osculating orbits, and trails. Cache policy is part of this workflow
because calculation freshness and provenance are scientific invariants.

### Catalog semantic index

The Phoenix/Postgres projection used for search, object detail, viewport
hydration, nearest-object queries, public pages, and summaries. It serves
meaning, not the dense rendering hot path.

### Catalog import

The normalization and validation of source-specific catalog snapshots into the
catalog semantic index. Source provenance and missing-value semantics must
survive import.

### Offline tile build

The deterministic compilation and audit of dense catalog data into immutable
point-layer manifests and containers.

## Invariants

- Scientific uncertainty remains explicit; missing evidence is never invented.
- Dynamic ephemerides, catalog meaning, and bulk visualization remain distinct.
- The stable browser route may select a different immutable catalog release.
- Source-specific behavior stays with the source adapter that owns it.
- A source file may be large when it is cohesive data, but orchestration must
  live behind a small interface with focused tests.
