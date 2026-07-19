#!/usr/bin/env python3
"""Build immutable catalog point tiles for the WebGL star layer.

The browser should load dense background points like map tiles: static files
with a manifest, not database-backed queries on every pan or zoom.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import shutil
import struct
import subprocess
import sys
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smp3 import (
    SMP3_FLAG_EXTENTS,
    SMP3_FLAG_SOURCE_IDS,
    SMP3_HEADER,
    SMP3_MAGIC,
    SMP3_RECORD,
    SMP3_VERSION,
    TileKey,
    write_container,
)


POINT_BINARY_MAGIC = b"SMP2"
POINT_SAMPLE_BUCKET_COUNT = 1024
SPARSE_LAYER_FULL_SAMPLE_MAX_POINTS = 5_000
POINT_RGB = (224, 196, 128)
DEFAULT_GROUPS = (
    "gaia_local_stars",
    "gaia_500pc_stars",
    "gaia_10kpc_bright_stars",
)
DEFAULT_LAYERS = (
    # Keep the heavy Gaia rows in exactly one physical layer. Duplicating them
    # into both a Gaia layer and a broad "stars" layer exhausts the app
    # container filesystem before the upload step.
    "gaia_stars:gaia_local_stars|gaia_500pc_stars|gaia_10kpc_bright_stars:star",
    "exoplanet_stars:nearby_exoplanet_systems|exoplanet_systems:star",
    "planets:exoplanets:planet",
    # JPL small bodies stay on the semantic viewport-object path. The static
    # pyramid starts at 2^24 AU and its 16-bit positions resolve only ~256 AU,
    # which collapses Solar-System objects onto false grid points and drops the
    # stable identity required for selection.
    "deep_sky:messier_deep_sky|ngc_ic_deep_sky|simbad_extragalactic|simbad_compact_objects|bass_dr2_black_holes|curated_extragalactic_survey:galaxy|quasar|active_galaxy|black_hole|pulsar|nebula|star_cluster",
    "galaxies:messier_deep_sky|ngc_ic_deep_sky|simbad_extragalactic|curated_extragalactic_survey:galaxy",
    "quasars:simbad_extragalactic|curated_extragalactic_survey:quasar",
    "active_galaxies:simbad_extragalactic|curated_extragalactic_survey:active_galaxy",
    "black_holes:simbad_compact_objects|bass_dr2_black_holes:black_hole",
    "pulsars:simbad_compact_objects:pulsar",
    "nebulae:messier_deep_sky|ngc_ic_deep_sky:nebula",
    "star_clusters:messier_deep_sky|ngc_ic_deep_sky:star_cluster",
)
DEFAULT_LEVELS = (
    # span_log2:sample_buckets:max_points_per_tile
    # Close zooms are served by the finest spans and keep every catalog point
    # (full 1024 sample buckets). The pyramid starts at span 2^24 (~265 ly):
    # finer spans explode into hundreds of thousands of near-empty one-file
    # tiles, which exhausts build disk and upload time. The finest level
    # instead raises its per-tile cap so the dense solar-neighborhood tiles
    # keep every star. The deep-sky and universe-scale levels below
    # deliberately taper sampling so zoomed-out frames stay sparse.
    "24:1024:65000",
    "26:1024:32000",
    "28:1024:24000",
    "30:1024:24000",
    "32:1024:24000",
    "34:1024:24000",
    # Deep-sky/cosmic-web layers need spans beyond the Milky Way; these keep
    # galaxy/quasar tiles available at Local Group and redshift-survey scales.
    "36:512:18000",
    "38:256:16000",
    "40:128:14000",
    "42:128:12000",
    "44:64:12000",
    # Universe-scale LOD: sparse survey bins for Local Supercluster, quasar,
    # and cosmic-web views. These are deliberately capped so a zoomed-out
    # browser frame can draw haze/cluster summaries without fetching hundreds
    # of thousands of raw points.
    "46:48:9000",
    "48:24:7500",
    "50:12:6000",
)
POINT_RGB_BY_TYPE = {
    "galaxy": (160, 205, 255),
    "active_galaxy": (255, 214, 139),
    "quasar": (255, 226, 147),
    "black_hole": (211, 176, 255),
    "pulsar": (138, 218, 255),
    "nebula": (184, 152, 255),
    "star_cluster": (207, 228, 255),
}
# Sprite style codes written into the record's reserved 4th color byte. The
# WebGL renderer keys per-type sprite shapes off these; keep them in sync with
# the style branches in src/webglPointRenderer.ts. Stars, asteroids, and
# exoplanets stay 0 and render as the default disc, so old tiles remain valid.
POINT_TYPE_CODES = {
    "galaxy": 1,
    "active_galaxy": 2,
    "quasar": 3,
    "black_hole": 4,
    "pulsar": 5,
    "nebula": 6,
    "star_cluster": 7,
}
DENSITY_SAMPLE_HEADROOM = 0.72
DEEP_SKY_COLOR_INDICES = {name: 240 + index for index, name in enumerate(POINT_RGB_BY_TYPE)}


@dataclass(frozen=True)
class TileLayer:
    id: str
    groups: list[str]
    types: list[str]


@dataclass(frozen=True)
class TileLevel:
    span_log2: int
    sample_buckets: int
    max_points_per_tile: int

    @property
    def span_au(self) -> int:
        return 2**self.span_log2


class TileFileCache:
    def __init__(self, root: Path, max_open_files: int):
        self.root = root
        self.max_open_files = max_open_files
        self.handles: OrderedDict[tuple[int, int, int], object] = OrderedDict()

    def write_record(self, key: tuple[int, int, int], record: bytes) -> None:
        handle = self._handle_for(key)
        handle.write(record)

    def close_all(self) -> None:
        for handle in self.handles.values():
            handle.close()
        self.handles.clear()

    def _handle_for(self, key: tuple[int, int, int]):
        handle = self.handles.get(key)
        if handle is not None:
            self.handles.move_to_end(key)
            return handle

        if len(self.handles) >= self.max_open_files:
            _, evicted = self.handles.popitem(last=False)
            evicted.close()

        span_log2, tile_x, tile_y = key
        path = tile_path(self.root, span_log2, tile_x, tile_y)
        created = not path.exists()
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("ab")
        if created:
            handle.write(POINT_BINARY_MAGIC)
            handle.write(struct.pack("<I", 0))
        self.handles[key] = handle
        return handle


def main() -> int:
    parser = argparse.ArgumentParser(description="Build static WebGL catalog point tiles.")
    parser.add_argument(
        "--format",
        choices=("SMP2", "SMP3"),
        default="SMP3",
        help="Tile format to build. SMP3 uses one range-readable SMPK1 container per layer.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("backend_phoenix/priv/static/catalog-tiles/v1"),
        help="Output directory for the tile version.",
    )
    parser.add_argument(
        "--levels",
        default=",".join(DEFAULT_LEVELS),
        help="Comma-separated span_log2:sample_buckets:max_points_per_tile entries.",
    )
    parser.add_argument(
        "--groups",
        default="",
        help="Legacy comma-separated catalog groups to include as a single gaia_stars layer.",
    )
    parser.add_argument(
        "--layers",
        default=",".join(DEFAULT_LAYERS),
        help="Comma-separated layer specs id:group|group:type|type. Use --groups for the legacy single-layer mode.",
    )
    parser.add_argument(
        "--max-open-files",
        type=int,
        default=384,
        help="Maximum tile files kept open while streaming rows.",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="Postgres URL. Defaults to DATABASE_URL.",
    )
    parser.add_argument(
        "--tile-url-base",
        default=os.environ.get("CATALOG_TILE_PUBLIC_BASE_URL", "/catalog-tiles/v1"),
        help="Public base URL for tile files, without manifest.json.",
    )
    parser.add_argument(
        "--version",
        default=os.environ.get("CATALOG_TILE_VERSION", ""),
        help="Catalog tile version written into the manifest. Defaults to the output directory name.",
    )
    parser.add_argument(
        "--skip-if-current",
        action="store_true",
        help="Skip the build when the existing manifest matches the current source counts and levels.",
    )
    args = parser.parse_args()

    levels = parse_levels(args.levels)
    layers = [TileLayer("gaia_stars", [group.strip() for group in args.groups.split(",") if group.strip()], ["star"])] if args.groups else parse_layers(args.layers)
    if not layers or any(not layer.groups for layer in layers):
        raise SystemExit("At least one catalog group is required.")

    output_dir = args.output.resolve()
    tile_version = normalize_tile_version(args.version, output_dir)
    tile_url_base = normalize_tile_url_base(args.tile_url_base)
    if args.format == "SMP3":
        return build_smp3(output_dir, tile_version, tile_url_base, args.database_url, levels, layers)
    if args.skip_if_current:
        current_counts = {layer.id: query_source_counts(args.database_url, layer.groups, layer.types) for layer in layers}
        manifest_state = current_manifest_state(output_dir / "manifest.json", levels, layers, current_counts, tile_url_base, tile_version)
        if manifest_state == "current":
            print(f"[catalog-tiles] Existing static tile manifest is current at {output_dir}; skipping build.", flush=True)
            return 0
        if manifest_state == "tile-url-mismatch":
            rewrite_manifest_tile_urls(output_dir / "manifest.json", tile_url_base)
            print(f"[catalog-tiles] Updated static tile URL templates in {output_dir / 'manifest.json'}; skipping rebuild.", flush=True)
            return 0

    staging_dir = output_dir.with_name(f".{output_dir.name}.tmp-{os.getpid()}")
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True)

    layer_manifests = []
    total_tiles = 0
    total_rows = 0
    for layer in layers:
        layer_dir = staging_dir / "layers" / layer.id
        counts: dict[tuple[int, int, int], int] = {}
        source_counts = {group: 0 for group in layer.groups}
        level_point_counts = {level.span_log2: 0 for level in levels}
        level_tile_counts = {level.span_log2: set() for level in levels}
        writer = TileFileCache(layer_dir, max(32, args.max_open_files))

        rows_seen = 0
        try:
            for key, x_au, y_au, catalog_group, object_type, sample_bucket in stream_catalog_points(args.database_url, layer.groups, layer.types):
                rows_seen += 1
                source_counts[catalog_group] = source_counts.get(catalog_group, 0) + 1
                record = struct.pack("<ffBBBB", x_au, y_au, *POINT_RGB_BY_TYPE.get(object_type, POINT_RGB), POINT_TYPE_CODES.get(object_type, 0))

                for level in levels:
                    if sample_bucket >= level.sample_buckets:
                        continue
                    tile_x = floor_div(x_au, level.span_au)
                    tile_y = floor_div(y_au, level.span_au)
                    tile_key = (level.span_log2, tile_x, tile_y)
                    current_count = counts.get(tile_key, 0)
                    if current_count >= level.max_points_per_tile:
                        continue
                    writer.write_record(tile_key, record)
                    counts[tile_key] = current_count + 1
                    level_point_counts[level.span_log2] += 1
                    level_tile_counts[level.span_log2].add((tile_x, tile_y))

                if rows_seen % 100_000 == 0:
                    print(
                        f"[catalog-tiles] layer {layer.id}: streamed {rows_seen:,} source rows into {len(counts):,} non-empty tiles",
                        file=sys.stderr,
                        flush=True,
                    )
        finally:
            writer.close_all()

        patch_tile_headers(layer_dir, counts)
        layer_manifests.append(layer_manifest(layer, levels, source_counts, level_point_counts, level_tile_counts, tile_url_base))
        total_tiles += sum(len(items) for items in level_tile_counts.values())
        total_rows += rows_seen

    write_manifest(staging_dir, layer_manifests, tile_version)
    replace_output_dir(staging_dir, output_dir)

    print(
        f"[catalog-tiles] built {total_tiles:,} tile files "
        f"from {total_rows:,} source rows across {len(layers)} layers at {output_dir}",
        flush=True,
    )
    return 0


def build_smp3(
    output_dir: Path,
    tile_version: str,
    tile_url_base: str,
    database_url: str,
    levels: list[TileLevel],
    layers: list[TileLayer],
) -> int:
    """Build magnitude-ordered SMP3 tiles into deterministic SMPK1 containers."""
    staging_dir = output_dir.with_name(f".{output_dir.name}.tmp-{os.getpid()}")
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True)
    color_lut = build_color_lut()
    layer_manifests: list[dict[str, object]] = []

    for layer in layers:
        raw_tile_counts = count_raw_tile_populations(database_url, layer.groups, layer.types, levels)
        effective_levels = density_preserving_levels(levels, raw_tile_counts)
        records: dict[TileKey, bytearray] = {}
        source_ids: dict[TileKey, bytearray] = {}
        counts: dict[TileKey, int] = {}
        overflow_tiles: set[TileKey] = set()
        source_counts = {group: 0 for group in layer.groups}
        level_point_counts = {level.span_log2: 0 for level in effective_levels}
        level_tile_counts = {level.span_log2: set() for level in effective_levels}
        finest_with_ids = {level.span_log2 for level in effective_levels[:2]} if layer.id == "gaia_stars" else set()
        rows_seen = 0

        for key, x_au, y_au, catalog_group, object_type, sample_bucket, magnitude, bp_rp, extent_ly, source_id in stream_catalog_points_v3(
            database_url, layer.groups, layer.types
        ):
            rows_seen += 1
            source_counts[catalog_group] = source_counts.get(catalog_group, 0) + 1
            encoded_mag = encode_magnitude(magnitude)
            color_idx = color_index(bp_rp, object_type)
            extent = encode_extent(extent_ly)
            for level in effective_levels:
                if sample_bucket >= level.sample_buckets:
                    continue
                tile_key = TileKey(level.span_log2, floor_div(x_au, level.span_au), floor_div(y_au, level.span_au))
                current_count = counts.get(tile_key, 0)
                if current_count >= level.max_points_per_tile:
                    overflow_tiles.add(tile_key)
                    continue
                origin_x = tile_key.x * level.span_au
                origin_y = tile_key.y * level.span_au
                qx = quantize(x_au, origin_x, level.span_au)
                qy = quantize(y_au, origin_y, level.span_au)
                records.setdefault(tile_key, bytearray()).extend(
                    SMP3_RECORD.pack(qx, qy, encoded_mag, color_idx, POINT_TYPE_CODES.get(object_type, 0), extent)
                )
                if level.span_log2 in finest_with_ids:
                    source_ids.setdefault(tile_key, bytearray()).extend(struct.pack("<Q", source_id or 0))
                counts[tile_key] = current_count + 1
                level_point_counts[level.span_log2] += 1
                level_tile_counts[level.span_log2].add((tile_key.x, tile_key.y))
            if rows_seen % 100_000 == 0:
                print(f"[catalog-tiles] SMP3 layer {layer.id}: streamed {rows_seen:,} rows", file=sys.stderr, flush=True)

        if overflow_tiles:
            examples = ", ".join(f"s{key.span_log2}/x{key.x}/y{key.y}" for key in sorted(overflow_tiles)[:8])
            raise RuntimeError(
                f"Density-preserving sample still saturated {len(overflow_tiles)} {layer.id} tiles ({examples}). "
                "Lower DENSITY_SAMPLE_HEADROOM or add a finer level; capped tiles would create visible seams."
            )

        tiles: dict[TileKey, bytes] = {}
        for tile_key, record_data in records.items():
            span = float(2**tile_key.span_log2)
            ids = source_ids.get(tile_key, bytearray())
            flags = (SMP3_FLAG_SOURCE_IDS if ids else 0)
            if any(record_data[offset + 7] for offset in range(0, len(record_data), SMP3_RECORD.size)):
                flags |= SMP3_FLAG_EXTENTS
            header = SMP3_HEADER.pack(
                SMP3_MAGIC,
                SMP3_VERSION,
                flags,
                tile_key.x * span,
                tile_key.y * span,
                span,
                counts[tile_key],
            )
            tiles[tile_key] = header + bytes(record_data) + bytes(ids)

        container_name = f"{layer.id}.smpk"
        write_container(staging_dir / container_name, tiles)
        layer_manifests.append(
            {
                "id": layer.id,
                "groups": layer.groups,
                "types": layer.types,
                "source_counts": source_counts,
                "container": f"{tile_url_base}/{container_name}",
                "container_format": "SMPK1",
                "levels": [
                    {
                        "span_log2": level.span_log2,
                        "span_au": level.span_au,
                        "sample_buckets": level.sample_buckets,
                        "sample_bucket_count": POINT_SAMPLE_BUCKET_COUNT,
                        "raw_max_points_per_tile": max(
                            (
                                count
                                for key, count in raw_tile_counts.items()
                                if key.span_log2 == level.span_log2
                            ),
                            default=0,
                        ),
                        "max_points_per_tile": level.max_points_per_tile,
                        "tile_count": len(level_tile_counts[level.span_log2]),
                        "point_count": level_point_counts[level.span_log2],
                    }
                    for level in effective_levels
                ],
            }
        )

    manifest = {
        "version": tile_version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "projection": "heliocentric_ecliptic_top_down_au",
        "format": "SMP3",
        "record_bytes": SMP3_RECORD.size,
        "container_format": "SMPK1",
        "records_sorted_by": "magnitude",
        "mag_encoding": {"offset": -2.0, "step": 0.1, "missing": 255},
        "color_lut": color_lut,
        "sample_bucket_count": POINT_SAMPLE_BUCKET_COUNT,
        "sampling": {
            "method": "level-wide deterministic hash",
            "headroom": DENSITY_SAMPLE_HEADROOM,
        },
        "layers": layer_manifests,
    }
    (staging_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    replace_output_dir(staging_dir, output_dir)
    print(f"[catalog-tiles] built SMP3 containers for {len(layers)} layers at {output_dir}", flush=True)
    return 0


def count_raw_tile_populations(
    database_url: str,
    groups: list[str],
    types: list[str] | None,
    levels: list[TileLevel],
) -> dict[TileKey, int]:
    """Count the unsampled population so a whole level shares one rate.

    A per-tile cap without a level-wide rate makes every busy square appear
    equally dense and exposes the pyramid grid. This lightweight first pass
    lets sparse and dense tiles retain their real ratio after sampling.
    """
    counts: dict[TileKey, int] = {}
    rows_seen = 0
    for x_au, y_au in stream_catalog_positions(database_url, groups, types):
        rows_seen += 1
        for level in levels:
            key = TileKey(level.span_log2, floor_div(x_au, level.span_au), floor_div(y_au, level.span_au))
            counts[key] = counts.get(key, 0) + 1
    print(
        f"[catalog-tiles] counted {rows_seen:,} source rows across {len(counts):,} raw tile populations",
        file=sys.stderr,
        flush=True,
    )
    return counts


def density_preserving_levels(levels: list[TileLevel], raw_counts: dict[TileKey, int]) -> list[TileLevel]:
    effective: list[TileLevel] = []
    for level in levels:
        level_counts = [count for key, count in raw_counts.items() if key.span_log2 == level.span_log2]
        maximum = max(level_counts, default=0)
        total = sum(level_counts)
        safe_buckets = POINT_SAMPLE_BUCKET_COUNT if maximum < level.max_points_per_tile else max(
            1,
            int(POINT_SAMPLE_BUCKET_COUNT * level.max_points_per_tile * DENSITY_SAMPLE_HEADROOM / maximum),
        )
        # A sparse type layer should never randomly lose its entire population
        # merely because the broad universe level uses a low default sample.
        # Keep every point only for globally small layers whose busiest tile
        # also fits the cap; distributed large layers retain the LOD taper.
        sample_buckets = (
            POINT_SAMPLE_BUCKET_COUNT
            if total <= SPARSE_LAYER_FULL_SAMPLE_MAX_POINTS and maximum < level.max_points_per_tile
            else min(level.sample_buckets, safe_buckets)
        )
        effective.append(TileLevel(level.span_log2, sample_buckets, level.max_points_per_tile))
        print(
            f"[catalog-tiles] level s{level.span_log2}: raw max {maximum:,}, "
            f"sample {sample_buckets}/{POINT_SAMPLE_BUCKET_COUNT}, cap {level.max_points_per_tile:,}",
            file=sys.stderr,
            flush=True,
        )
    return effective


def encode_magnitude(value: float | None) -> int:
    if value is None:
        return 255
    return max(0, min(255, round((value + 2.0) * 10)))


def encode_extent(value: float | None) -> int:
    if value is None or value <= 0:
        return 0
    return max(1, min(255, round(math.log2(value) * 16 + 64)))


def quantize(value: float, origin: float, span: float) -> int:
    return max(0, min(65535, round((value - origin) / span * 65535)))


def color_index(bp_rp: float | None, object_type: str) -> int:
    if object_type in DEEP_SKY_COLOR_INDICES:
        return DEEP_SKY_COLOR_INDICES[object_type]
    if bp_rp is None:
        return 16
    return max(0, min(31, round((bp_rp + 0.6) / 5.0 * 31)))


def build_color_lut() -> list[list[int]]:
    # Compact blackbody-like ramp based on the color progression used by
    # planetarium renderers: blue-white hot stars through amber-red cool ones.
    anchors = ((155, 190, 255), (226, 232, 255), (255, 244, 214), (255, 190, 120), (255, 126, 72))
    lut: list[list[int]] = []
    for index in range(32):
        position = index / 31 * (len(anchors) - 1)
        left = min(len(anchors) - 2, int(position))
        mix = position - left
        lut.append([round(anchors[left][channel] * (1 - mix) + anchors[left + 1][channel] * mix) for channel in range(3)])
    lut.extend([[224, 196, 128] for _ in range(256 - len(lut))])
    for object_type, index in DEEP_SKY_COLOR_INDICES.items():
        lut[index] = list(POINT_RGB_BY_TYPE[object_type])
    return lut


def stream_catalog_points_v3(database_url: str, groups: list[str], types: list[str] | None = None):
    group_sql = ", ".join(sql_literal(group) for group in groups)
    type_filter = ""
    if types:
        type_filter = f"    AND object_type IN ({', '.join(sql_literal(item) for item in types)})\n"
    sql = f"""
COPY (
  SELECT key, x_au::double precision, y_au::double precision, catalog_group,
    object_type,
    mod(hashtext(key)::bigint + 2147483648, {POINT_SAMPLE_BUCKET_COUNT})::integer,
    apparent_magnitude::double precision,
    CASE WHEN facts->>'bp_rp' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (facts->>'bp_rp')::double precision END,
    CASE WHEN facts->>'extent_ly' ~ '^[0-9]+([.][0-9]+)?$' THEN (facts->>'extent_ly')::double precision END,
    CASE WHEN coalesce(external_ids->>'gaia_dr3_source_id', external_ids->>'gaia_dr3', '') ~ '^[0-9]+$'
      THEN coalesce(external_ids->>'gaia_dr3_source_id', external_ids->>'gaia_dr3')::bigint ELSE 0 END
  FROM catalog_source_objects
  WHERE catalog_group IN ({group_sql}) AND x_au IS NOT NULL AND y_au IS NOT NULL
{type_filter.rstrip()}
  ORDER BY apparent_magnitude ASC NULLS LAST, key ASC
) TO STDOUT WITH (FORMAT csv)
"""
    command = ["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"]
    normalized_url = normalize_database_url(database_url)
    if normalized_url:
        command.extend(["--dbname", normalized_url])
    command.extend(["--command", sql])
    process = subprocess.Popen(command, stdout=subprocess.PIPE, text=True)
    assert process.stdout is not None
    try:
        for row in csv.reader(process.stdout):
            if len(row) != 10:
                raise RuntimeError(f"Unexpected SMP3 point row shape: {row!r}")
            key, x, y, group, object_type, bucket, magnitude, bp_rp, extent, source_id = row
            yield key, float(x), float(y), group, object_type, int(bucket), optional_float(magnitude), optional_float(bp_rp), optional_float(extent), int(source_id or 0)
    finally:
        process.stdout.close()
    if process.wait() != 0:
        raise RuntimeError("psql SMP3 catalog point export failed")


def stream_catalog_positions(database_url: str, groups: list[str], types: list[str] | None = None):
    group_sql = ", ".join(sql_literal(group) for group in groups)
    type_filter = ""
    if types:
        type_filter = f"    AND object_type IN ({', '.join(sql_literal(item) for item in types)})\n"
    sql = f"""
COPY (
  SELECT x_au::double precision, y_au::double precision
  FROM catalog_source_objects
  WHERE catalog_group IN ({group_sql}) AND x_au IS NOT NULL AND y_au IS NOT NULL
{type_filter.rstrip()}
) TO STDOUT WITH (FORMAT csv)
"""
    command = ["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"]
    normalized_url = normalize_database_url(database_url)
    if normalized_url:
        command.extend(["--dbname", normalized_url])
    command.extend(["--command", sql])
    process = subprocess.Popen(command, stdout=subprocess.PIPE, text=True)
    assert process.stdout is not None
    try:
        for row in csv.reader(process.stdout):
            if len(row) != 2:
                raise RuntimeError(f"Unexpected catalog position row shape: {row!r}")
            yield float(row[0]), float(row[1])
    finally:
        process.stdout.close()
    if process.wait() != 0:
        raise RuntimeError("psql catalog position export failed")


def optional_float(value: str) -> float | None:
    return float(value) if value else None


def parse_levels(value: str) -> list[TileLevel]:
    levels: list[TileLevel] = []
    for raw_entry in value.split(","):
        entry = raw_entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3:
            raise SystemExit(f"Invalid level entry {entry!r}; expected span_log2:sample_buckets:max_points_per_tile.")
        span_log2, sample_buckets, max_points = (int(part) for part in parts)
        if span_log2 < 0:
            raise SystemExit(f"Invalid span_log2 in {entry!r}.")
        if sample_buckets < 1 or sample_buckets > POINT_SAMPLE_BUCKET_COUNT:
            raise SystemExit(f"Invalid sample bucket count in {entry!r}.")
        if max_points < 1:
            raise SystemExit(f"Invalid max point count in {entry!r}.")
        levels.append(TileLevel(span_log2, sample_buckets, max_points))
    if not levels:
        raise SystemExit("At least one tile level is required.")
    return sorted(levels, key=lambda level: level.span_log2)


def parse_layers(value: str) -> list[TileLayer]:
    layers: list[TileLayer] = []
    for raw_entry in value.split(","):
        entry = raw_entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3:
            raise SystemExit(f"Invalid layer entry {entry!r}; expected id:group|group:type|type.")
        layer_id, raw_groups, raw_types = parts
        groups = [group.strip() for group in raw_groups.split("|") if group.strip()]
        types = [item.strip() for item in raw_types.split("|") if item.strip()]
        if not layer_id or not groups:
            raise SystemExit(f"Invalid layer entry {entry!r}; layer id and groups are required.")
        layers.append(TileLayer(layer_id, groups, types))
    if not layers:
        raise SystemExit("At least one tile layer is required.")
    return layers


def stream_catalog_points(database_url: str, groups: list[str], types: list[str] | None = None):
    group_sql = ", ".join(sql_literal(group) for group in groups)
    type_filter = ""
    if types:
        type_sql = ", ".join(sql_literal(item) for item in types)
        type_filter = f"    AND object_type IN ({type_sql})\n"
    sql = f"""
    COPY (
  SELECT
    key,
    x_au::double precision,
    y_au::double precision,
    catalog_group,
    object_type,
    mod(hashtext(key)::bigint + 2147483648, {POINT_SAMPLE_BUCKET_COUNT})::integer AS sample_bucket
  FROM catalog_source_objects
  WHERE catalog_group IN ({group_sql})
    AND x_au IS NOT NULL
    AND y_au IS NOT NULL
{type_filter.rstrip()}
) TO STDOUT WITH (FORMAT csv)
"""

    command = ["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"]
    normalized_url = normalize_database_url(database_url)
    if normalized_url:
        command.extend(["--dbname", normalized_url])
    command.extend(["--command", sql])

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=None,
        text=True,
    )
    assert process.stdout is not None

    try:
        reader = csv.reader(process.stdout)
        for row in reader:
            if len(row) != 6:
                raise RuntimeError(f"Unexpected point row shape: {row!r}")
            key, x_au, y_au, catalog_group, object_type, sample_bucket = row
            yield key, float(x_au), float(y_au), catalog_group, object_type, int(sample_bucket)
    finally:
        process.stdout.close()

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"psql catalog point export failed with exit code {return_code}.")


def query_source_counts(database_url: str, groups: list[str], types: list[str] | None = None) -> dict[str, int]:
    group_sql = ", ".join(sql_literal(group) for group in groups)
    type_filter = ""
    if types:
        type_sql = ", ".join(sql_literal(item) for item in types)
        type_filter = f"    AND object_type IN ({type_sql})\n"
    sql = f"""
COPY (
  SELECT catalog_group, count(*)::bigint
  FROM catalog_source_objects
  WHERE catalog_group IN ({group_sql})
{type_filter.rstrip()}
  GROUP BY catalog_group
) TO STDOUT WITH (FORMAT csv)
"""

    counts = {group: 0 for group in groups}
    command = ["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"]
    normalized_url = normalize_database_url(database_url)
    if normalized_url:
        command.extend(["--dbname", normalized_url])
    command.extend(["--command", sql])

    result = subprocess.run(command, check=True, stdout=subprocess.PIPE, text=True)
    for row in csv.reader(result.stdout.splitlines()):
        if len(row) != 2:
            raise RuntimeError(f"Unexpected source count row shape: {row!r}")
        group, count = row
        counts[group] = int(count)
    return counts


def current_manifest_state(
    manifest_path: Path,
    levels: list[TileLevel],
    layers: list[TileLayer],
    source_counts_by_layer: dict[str, dict[str, int]],
    tile_url_base: str,
    tile_version: str,
) -> str:
    if not manifest_path.is_file():
        return "missing"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "invalid"

    if manifest.get("format") != "SMP2":
        return "invalid"
    if manifest.get("version") != tile_version:
        return "stale"

    manifest_layers = manifest.get("layers")
    if not isinstance(manifest_layers, list):
        return "stale"
    if len(manifest_layers) != len(layers):
        return "stale"

    expected_levels = expected_level_headers(levels)
    for manifest_layer, layer in zip(manifest_layers, layers):
        if not isinstance(manifest_layer, dict):
            return "invalid"
        if manifest_layer.get("id") != layer.id or manifest_layer.get("groups") != layer.groups or manifest_layer.get("types") != layer.types:
            return "stale"
        if manifest_layer.get("source_counts") != source_counts_by_layer.get(layer.id, {}):
            return "stale"
        if manifest_layer.get("tile_url_template") != tile_url_template_for_layer(tile_url_base, layer.id):
            return "tile-url-mismatch"
        try:
            manifest_levels = [
                {
                    "span_log2": int(level.get("span_log2", -1)),
                    "span_au": int(level.get("span_au", -1)),
                    "sample_buckets": int(level.get("sample_buckets", -1)),
                    "max_points_per_tile": int(level.get("max_points_per_tile", -1)),
                }
                for level in manifest_layer.get("levels", [])
            ]
        except (TypeError, ValueError, AttributeError):
            return "invalid"
        if manifest_levels != expected_levels:
            return "stale"
    return "current"


def rewrite_manifest_tile_urls(manifest_path: Path, tile_url_base: str) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat()
    for layer in manifest.get("layers", []):
        if isinstance(layer, dict) and isinstance(layer.get("id"), str):
            layer["tile_url_template"] = tile_url_template_for_layer(tile_url_base, layer["id"])
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("ecto://"):
        return f"postgresql://{database_url[len('ecto://'):]}"
    return database_url


def normalize_tile_url_base(tile_url_base: str) -> str:
    normalized = tile_url_base.strip()
    if not normalized:
        normalized = "/catalog-tiles/v1"
    return normalized.rstrip("/")


def normalize_tile_version(tile_version: str, output_dir: Path) -> str:
    normalized = tile_version.strip() or output_dir.name or "v1"
    if "/" in normalized or normalized in {".", ".."}:
        raise SystemExit(f"Invalid catalog tile version {normalized!r}.")
    return normalized


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def floor_div(value: float, span: int) -> int:
    return int(value // span)


def tile_path(root: Path, span_log2: int, tile_x: int, tile_y: int) -> Path:
    return root / f"s{span_log2}" / f"x{tile_x}" / f"y{tile_y}.bin"


def patch_tile_headers(root: Path, counts: dict[tuple[int, int, int], int]) -> None:
    for (span_log2, tile_x, tile_y), count in counts.items():
        path = tile_path(root, span_log2, tile_x, tile_y)
        with path.open("r+b") as handle:
            handle.seek(4)
            handle.write(struct.pack("<I", count))


def expected_level_headers(levels: list[TileLevel]) -> list[dict[str, int]]:
    return [
        {
            "span_log2": level.span_log2,
            "span_au": level.span_au,
            "sample_buckets": level.sample_buckets,
            "max_points_per_tile": level.max_points_per_tile,
        }
        for level in levels
    ]


def tile_url_template_for_layer(tile_url_base: str, layer_id: str) -> str:
    return f"{tile_url_base}/layers/{layer_id}/s{{span_log2}}/x{{x}}/y{{y}}.bin"


def layer_manifest(
    layer: TileLayer,
    levels: list[TileLevel],
    source_counts: dict[str, int],
    level_point_counts: dict[int, int],
    level_tile_counts: dict[int, set[tuple[int, int]]],
    tile_url_base: str,
) -> dict[str, object]:
    return {
        "id": layer.id,
        "groups": layer.groups,
        "types": layer.types,
        "source_counts": source_counts,
        "tile_url_template": tile_url_template_for_layer(tile_url_base, layer.id),
        "levels": [
            {
                "span_log2": level.span_log2,
                "span_au": level.span_au,
                "sample_buckets": level.sample_buckets,
                "max_points_per_tile": level.max_points_per_tile,
                "tile_count": len(level_tile_counts[level.span_log2]),
                "point_count": level_point_counts[level.span_log2],
            }
            for level in levels
        ],
    }


def write_manifest(root: Path, layers: list[dict[str, object]], tile_version: str) -> None:
    manifest = {
        "version": tile_version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "projection": "heliocentric_ecliptic_top_down_au",
        "format": "SMP2",
        "record_bytes": 12,
        "sample_bucket_count": POINT_SAMPLE_BUCKET_COUNT,
        "layers": layers,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def replace_output_dir(staging_dir: Path, output_dir: Path) -> None:
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    backup_dir = output_dir.with_name(f".{output_dir.name}.old-{os.getpid()}")
    if backup_dir.exists():
        shutil.rmtree(backup_dir)
    if output_dir.exists():
        output_dir.rename(backup_dir)
    staging_dir.rename(output_dir)
    if backup_dir.exists():
        shutil.rmtree(backup_dir)


if __name__ == "__main__":
    raise SystemExit(main())
