#!/usr/bin/env python3
"""Build immutable catalog point tiles for the WebGL star layer.

The browser should load dense background points like map tiles: static files
with a manifest, not database-backed queries on every pan or zoom.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import struct
import subprocess
import sys
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


POINT_BINARY_MAGIC = b"SMP2"
POINT_SAMPLE_BUCKET_COUNT = 1024
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
    "exoplanet_systems:nearby_exoplanet_systems|exoplanet_systems|exoplanets:",
    "small_bodies:jpl_small_bodies:asteroid|comet|small_body",
    "deep_sky:messier_deep_sky|simbad_extragalactic|simbad_compact_objects:galaxy|quasar|active_galaxy|black_hole|pulsar|nebula|star_cluster",
    "galaxies:messier_deep_sky|simbad_extragalactic:galaxy",
    "quasars:simbad_extragalactic:quasar",
    "active_galaxies:simbad_extragalactic:active_galaxy",
    "black_holes:simbad_compact_objects:black_hole",
    "pulsars:simbad_compact_objects:pulsar",
    "nebulae:messier_deep_sky:nebula",
    "star_clusters:messier_deep_sky:star_cluster",
)
DEFAULT_LEVELS = (
    # span_log2:sample_buckets:max_points_per_tile
    # Keep the widest views sampled, then ramp up quickly so close zooms
    # feel like a dense star field instead of sparse debug data.
    "20:64:24000",
    "22:128:24000",
    "24:256:24000",
    "26:512:24000",
    "28:1024:24000",
    "30:1024:24000",
    "32:1024:24000",
    "34:1024:24000",
)


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
    tile_url_base = normalize_tile_url_base(args.tile_url_base)
    if args.skip_if_current:
        current_counts = {layer.id: query_source_counts(args.database_url, layer.groups, layer.types) for layer in layers}
        manifest_state = current_manifest_state(output_dir / "manifest.json", levels, layers, current_counts, tile_url_base)
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
            for key, x_au, y_au, catalog_group, sample_bucket in stream_catalog_points(args.database_url, layer.groups, layer.types):
                rows_seen += 1
                source_counts[catalog_group] = source_counts.get(catalog_group, 0) + 1
                record = struct.pack("<ffBBBB", x_au, y_au, *POINT_RGB, 0)

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

    write_manifest(staging_dir, layer_manifests)
    replace_output_dir(staging_dir, output_dir)

    print(
        f"[catalog-tiles] built {total_tiles:,} tile files "
        f"from {total_rows:,} source rows across {len(layers)} layers at {output_dir}",
        flush=True,
    )
    return 0


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
    mod(hashtext(key)::bigint + 2147483648, {POINT_SAMPLE_BUCKET_COUNT})::integer AS sample_bucket
  FROM catalog_objects
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
            if len(row) != 5:
                raise RuntimeError(f"Unexpected point row shape: {row!r}")
            key, x_au, y_au, catalog_group, sample_bucket = row
            yield key, float(x_au), float(y_au), catalog_group, int(sample_bucket)
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
  FROM catalog_objects
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
) -> str:
    if not manifest_path.is_file():
        return "missing"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "invalid"

    if manifest.get("format") != "SMP2":
        return "invalid"

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


def write_manifest(root: Path, layers: list[dict[str, object]]) -> None:
    manifest = {
        "version": "v1",
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
