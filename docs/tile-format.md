# Catalog Tile Format

Dense catalog layers are published as immutable binary tile pyramids. The
browser selects visible tiles from the current map bounds and zoom level, then
decodes them in a worker. Search and object detail remain semantic API calls;
bulk point rendering does not query Postgres during pan and zoom.

The authoritative codec implementation is `scripts/smp3.py`. Browser decoding
lives in `src/catalogPointTileWorker.ts`.

## SMP3 tile

All numeric fields are little-endian. An SMP3 tile contains a 32-byte header,
followed by fixed eight-byte point records and, when flagged, a trailing array
of unsigned 64-bit source identifiers.

### Header

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | 4 bytes | ASCII magic `SMP3` |
| 4 | `uint16` | format version, currently `1` |
| 6 | `uint16` | flags |
| 8 | `float64` | tile origin x, AU |
| 16 | `float64` | tile origin y, AU |
| 24 | `float32` | tile span, AU |
| 28 | `uint32` | point count |

Flag bit `1` indicates a trailing source-ID array. Flag bit `2` indicates that
the extent byte is meaningful.

### Point record

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `uint16` | x quantized across the tile span |
| 2 | `uint16` | y quantized across the tile span |
| 4 | `uint8` | encoded magnitude; `255` means unavailable |
| 5 | `uint8` | color lookup-table index |
| 6 | `uint8` | object-type code |
| 7 | `uint8` | encoded physical extent, or `0` when unavailable |

Records are sorted by encoded magnitude. That invariant permits bounded prefix
reads while keeping the brightest retained points deterministic.

## SMPK1 container

Large layers pack their tiles into one Range-readable SMPK1 container. The
container begins with a 16-byte header:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | 8 bytes | magic `SMPK1` followed by three NUL bytes |
| 8 | `uint32` | version, currently `1` |
| 12 | `uint32` | index entry count |

Each 24-byte index entry contains a tile span exponent, signed x/y tile
coordinates, an unsigned 64-bit byte offset, and a 32-bit payload length. Tile
payloads follow the sorted index. Clients read the header and index once, then
request only the byte ranges for visible tiles.

## Levels and sampling

A manifest describes each layer, container URL, projection, color lookup
table, available span levels, source counts, retained counts, and sampling
parameters. A level's tile span is `2^span_log2` AU.

When a source layer is denser than a browser-safe level, builders retain a
deterministic hash-bucket sample before applying the per-tile cap. Manifests
record both the raw and retained counts and the sample-bucket ratio. Builders
fail when a sample saturates a tile cap, because silently truncating saturated
tiles would create visible density seams.

Immutable versioned manifests and containers make the same release and zoom
level reproducible across clients.
