#!/usr/bin/env python3
"""Offline Gaia DR3 count, partition, and deterministic SMP3 encode pipeline.

This command is intentionally refused on the application host. Run it on a
workstation with DuckDB, PyArrow, ample scratch disk, and the Gaia Parquet
columns retained by scripts/download_gaia_dr3.py.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smp3 import (
    SMP3_FLAG_SOURCE_IDS,
    SMP3_HEADER,
    SMP3_MAGIC,
    SMP3_RECORD,
    SMP3_VERSION,
    SMPK1_ENTRY,
    SMPK1_HEADER,
    SMPK1_MAGIC,
    TileKey,
)

AU_PER_PC = 206_264.80624709636
LEVELS = ((20, 65_000), (22, 65_000), (24, 65_000), (26, 32_000), (28, 24_000), (30, 24_000), (32, 24_000), (34, 24_000), (36, 18_000), (38, 16_000), (40, 14_000), (42, 12_000), (44, 12_000), (46, 9_000), (48, 7_500), (50, 6_000))
SOURCE_ID_LEVELS = {20, 22}
TIERS = {"T1": 10.0, "T2": 5.0, "T3": 3.0}
HASH_BUCKET_COUNT = 1_048_576
DENSITY_SAMPLE_HEADROOM = 0.72


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("count", "partition", "encode"))
    parser.add_argument("--input", required=True, help="Parquet glob or partition directory")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tier", choices=tuple(TIERS), help="Required for partition")
    parser.add_argument("--version", default="")
    parser.add_argument(
        "--temp-directory",
        type=Path,
        help="DuckDB spill directory (defaults beside --output on the durable build volume)",
    )
    parser.add_argument("--memory-limit", help="DuckDB memory limit, for example 24GB")
    parser.add_argument("--threads", type=int, help="DuckDB worker thread limit")
    args = parser.parse_args()
    refuse_application_host()
    duckdb = require_duckdb()
    connection = duckdb.connect()
    connection.execute("SET preserve_insertion_order=false")
    temp_directory = args.temp_directory or args.output.parent / ".duckdb-tmp"
    temp_directory.mkdir(parents=True, exist_ok=True)
    escaped_temp_directory = str(temp_directory).replace("'", "''")
    connection.execute(f"SET temp_directory='{escaped_temp_directory}'")
    if args.memory_limit:
        escaped_memory_limit = args.memory_limit.replace("'", "''")
        connection.execute(f"SET memory_limit='{escaped_memory_limit}'")
    if args.threads:
        connection.execute(f"SET threads={args.threads}")
    connection.execute("SET enable_progress_bar=true")
    if args.command == "count":
        return count_tiers(connection, args.input, args.output)
    if args.command == "partition":
        if not args.tier:
            parser.error("--tier is required for partition; choose it only after reviewing count output")
        return partition(connection, args.input, args.output, args.tier)
    return encode(connection, args.input, args.output, args.version or args.output.name)


def refuse_application_host() -> None:
    if os.environ.get("SKYCHART_APPLICATION_HOST") == "1":
        raise SystemExit("Refusing to run the Gaia bulk pipeline on the application host.")
    if os.environ.get("SKYCHART_ALLOW_BULK_PIPELINE") != "1":
        raise SystemExit(
            "Bulk catalog pipelines are disabled by default. Set "
            "SKYCHART_ALLOW_BULK_PIPELINE=1 on a dedicated build workstation."
        )


def require_duckdb():
    try:
        import duckdb
        return duckdb
    except ImportError as error:
        raise SystemExit("Install scripts/gaia_bulk_requirements.txt in an offline build environment.") from error


def parquet_source(path: str) -> str:
    escaped = path.replace("'", "''")
    return f"read_parquet('{escaped}', union_by_name=true, hive_partitioning=true)"


def count_tiers(connection, source: str, output: Path) -> int:
    sql = "SELECT " + ", ".join(
        f"count(*) FILTER (WHERE parallax > 0 AND parallax_over_error >= {cut})::BIGINT AS {tier.lower()}"
        for tier, cut in TIERS.items()
    ) + f" FROM {parquet_source(source)}"
    row = connection.execute(sql).fetchone()
    counts = {tier: int(row[index]) for index, tier in enumerate(TIERS)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"cuts": TIERS, "counts": counts}, indent=2) + "\n")
    print(json.dumps(counts, indent=2))
    return 0


def partition(connection, source: str, output: Path, tier: str) -> int:
    output.mkdir(parents=True, exist_ok=True)
    cut = TIERS[tier]
    projected_path = output / "_projected.parquet"
    if projected_path.exists():
        projected_path.unlink()
    projected_destination = str(projected_path).replace("'", "''")
    # Equatorial Cartesian -> ecliptic Cartesian at J2016 using mean obliquity.
    connection.execute(f"""
        COPY (
          SELECT source_id::UBIGINT source_id, phot_g_mean_mag::REAL magnitude, bp_rp::REAL bp_rp,
            (1000.0 / parallax) * {AU_PER_PC} * cos(radians(dec)) * cos(radians(ra)) AS x_au,
            (1000.0 / parallax) * {AU_PER_PC} *
              (cos(radians(23.43928)) * cos(radians(dec)) * sin(radians(ra))
               + sin(radians(23.43928)) * sin(radians(dec))) AS y_au
          FROM {parquet_source(source)}
          WHERE parallax > 0 AND parallax_over_error >= {cut}
        ) TO '{projected_destination}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)
    """)
    projected_source = parquet_source(str(projected_path))
    selected_source_count = int(connection.execute(f"SELECT count(*) FROM {projected_source}").fetchone()[0])
    print(f"Projected {selected_source_count:,} {tier} sources", flush=True)

    level_metadata = []
    for level, cap in LEVELS:
        span = 2**level
        connection.execute("DROP TABLE IF EXISTS raw_tile_counts")
        connection.execute(f"""
            CREATE TEMP TABLE raw_tile_counts AS
            SELECT floor(x_au / {span})::INTEGER tile_x,
              floor(y_au / {span})::INTEGER tile_y,
              count(*)::BIGINT raw_tile_count
            FROM {projected_source}
            GROUP BY tile_x, tile_y
        """)
        raw_max, raw_tile_count = connection.execute(
            "SELECT coalesce(max(raw_tile_count), 0), count(*) FROM raw_tile_counts"
        ).fetchone()
        raw_max = int(raw_max)
        sample_buckets = HASH_BUCKET_COUNT if raw_max < cap else min(
            HASH_BUCKET_COUNT,
            max(1, int(HASH_BUCKET_COUNT * cap * DENSITY_SAMPLE_HEADROOM / raw_max)),
        )
        level_directory = output / f"level={level}"
        level_directory.mkdir(parents=True, exist_ok=True)
        level_path = level_directory / "data.parquet"
        if level_path.exists():
            level_path.unlink()
        level_destination = str(level_path).replace("'", "''")
        print(
            f"Level {level}: {raw_tile_count:,} raw tiles, max {raw_max:,}, "
            f"sample {sample_buckets}/{HASH_BUCKET_COUNT}",
            flush=True,
        )
        connection.execute(f"""
            COPY (
              WITH sampled AS (
                SELECT {level}::INTEGER AS level, raw.tile_x, raw.tile_y,
                  projected.x_au, projected.y_au, projected.magnitude, projected.bp_rp,
                  projected.source_id, raw.raw_tile_count,
                  {sample_buckets}::BIGINT sample_buckets
                FROM {projected_source} projected
                JOIN raw_tile_counts raw
                  ON raw.tile_x = floor(projected.x_au / {span})::INTEGER
                 AND raw.tile_y = floor(projected.y_au / {span})::INTEGER
                WHERE (hash(projected.source_id) % {HASH_BUCKET_COUNT}) < {sample_buckets}
              ), ranked AS (
                SELECT *,
                  count(*) OVER (PARTITION BY tile_x, tile_y)::BIGINT sampled_tile_count,
                  row_number() OVER (
                    PARTITION BY tile_x, tile_y
                    ORDER BY magnitude ASC NULLS LAST, source_id ASC
                  ) AS rank
                FROM sampled
              )
              SELECT level, tile_x, tile_y, x_au, y_au, magnitude, bp_rp, source_id,
                raw_tile_count, sampled_tile_count, sample_buckets,
                {HASH_BUCKET_COUNT}::BIGINT sample_bucket_count
              FROM ranked WHERE rank <= {cap}
              ORDER BY tile_x, tile_y, magnitude ASC NULLS LAST, source_id ASC
            ) TO '{level_destination}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)
        """)
        level_metadata.append({
            "level": level,
            "raw_tile_count": int(raw_tile_count),
            "raw_max_points_per_tile": raw_max,
            "sample_buckets": sample_buckets,
            "sample_bucket_count": HASH_BUCKET_COUNT,
        })

    projected_path.unlink()
    (output / "build.json").write_text(json.dumps({
        "tier": tier,
        "cut": cut,
        "source_counts": {"gaia_dr3_bulk": selected_source_count},
        "levels": LEVELS,
        "level_metadata": level_metadata,
        "sampling": {
            "method": "level-wide deterministic hash",
            "bucket_count": HASH_BUCKET_COUNT,
            "headroom": DENSITY_SAMPLE_HEADROOM,
        },
    }, indent=2) + "\n")
    return 0


def encode(connection, source: str, output: Path, version: str) -> int:
    output.mkdir(parents=True, exist_ok=True)
    build_path = Path(source) / "build.json"
    build = json.loads(build_path.read_text()) if build_path.exists() else {}
    manifest_levels = []
    level_metadata = {}
    total_tile_count = 0
    for level, cap in LEVELS:
        pattern = str(Path(source) / f"level={level}" / "*.parquet")
        metadata = connection.execute(
            f"SELECT max(sample_buckets), max(sample_bucket_count), "
            f"sum(raw_tile_count), max(raw_tile_count), max(sampled_tile_count), count(*) "
            f"FROM (SELECT DISTINCT tile_x, tile_y, raw_tile_count, sampled_tile_count, "
            f"sample_buckets, sample_bucket_count FROM {parquet_source(pattern)})"
        ).fetchone()
        if int(metadata[4] or 0) >= cap:
            raise RuntimeError(
                f"Density-preserving Gaia sample saturated level {level}: "
                f"{int(metadata[4])} retained points in a tile with cap {cap}. "
                "Lower DENSITY_SAMPLE_HEADROOM; capped tiles would create visible seams."
            )
        level_metadata[level] = metadata
        total_tile_count += int(metadata[5] or 0)

    with tempfile.TemporaryDirectory(prefix="skychart-gaia-smp3-") as scratch:
        scratch_root = Path(scratch)
        index_path = scratch_root / "gaia_stars.index"
        container_path = output / "gaia_stars.smpk"
        data_offset = SMPK1_HEADER.size + total_tile_count * SMPK1_ENTRY.size
        actual_tile_count = 0
        with container_path.open("w+b") as container, index_path.open("wb") as index:
            container.write(SMPK1_HEADER.pack(SMPK1_MAGIC, 1, total_tile_count))
            container.seek(data_offset)
            for level, cap in LEVELS:
                metadata = level_metadata[level]
                pattern = str(Path(source) / f"level={level}" / "*.parquet")
                cursor = connection.execute(
                    f"SELECT tile_x, tile_y, x_au, y_au, magnitude, bp_rp, source_id "
                    f"FROM {parquet_source(pattern)} "
                    f"ORDER BY tile_x, tile_y, magnitude ASC NULLS LAST, source_id"
                )
                current_key = None
                rows = []
                count = 0
                tile_count = 0
                while batch := cursor.fetchmany(100_000):
                    for tile_x, tile_y, x_au, y_au, magnitude, bp_rp, source_id in batch:
                        key = TileKey(level, int(tile_x), int(tile_y))
                        if current_key is not None and key != current_key:
                            write_tile(container, index, current_key, rows, level in SOURCE_ID_LEVELS)
                            tile_count += 1
                            actual_tile_count += 1
                            rows = []
                        current_key = key
                        rows.append((float(x_au), float(y_au), magnitude, bp_rp, int(source_id)))
                        count += 1
                if current_key is not None:
                    write_tile(container, index, current_key, rows, level in SOURCE_ID_LEVELS)
                    tile_count += 1
                    actual_tile_count += 1
                if tile_count != int(metadata[5] or 0):
                    raise RuntimeError(f"Level {level} tile count changed during encode")
                manifest_levels.append({
                    "span_log2": level,
                    "span_au": 2**level,
                    "max_points_per_tile": cap,
                    "tile_count": tile_count,
                    "point_count": count,
                    "raw_point_count": int(metadata[2] or 0),
                    "raw_max_points_per_tile": int(metadata[3] or 0),
                    "sample_buckets": int(metadata[0] or HASH_BUCKET_COUNT),
                    "sample_bucket_count": int(metadata[1] or HASH_BUCKET_COUNT),
                })
            if actual_tile_count != total_tile_count:
                raise RuntimeError("Container tile count changed during encode")
            index.flush()
            container.seek(SMPK1_HEADER.size)
            with index_path.open("rb") as index_source:
                shutil.copyfileobj(index_source, container, 8 * 1024 * 1024)
    manifest = {
        "version": version, "format": "SMP3", "container_format": "SMPK1",
        "records_sorted_by": "magnitude", "record_bytes": 8,
        "projection": "heliocentric_ecliptic_top_down_au",
        "source_counts": build.get("source_counts", {}),
        "gaia_tier": build.get("tier"),
        "parallax_over_error_min": build.get("cut"),
        "layers": [{
            "id": "gaia_stars",
            "groups": ["gaia_dr3_bulk"],
            "types": ["star"],
            "source_counts": build.get("source_counts", {}),
            "container": "gaia_stars.smpk",
            "container_format": "SMPK1",
            "levels": manifest_levels,
        }],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return 0


def write_tile(container, index, key: TileKey, rows: list[tuple], include_ids: bool) -> None:
    span = float(2**key.span_log2)
    origin_x, origin_y = key.x * span, key.y * span
    records = bytearray()
    ids = bytearray()
    for x, y, magnitude, bp_rp, source_id in rows:
        qx = max(0, min(65535, round((x - origin_x) / span * 65535)))
        qy = max(0, min(65535, round((y - origin_y) / span * 65535)))
        mag = 255 if magnitude is None else max(0, min(255, round((float(magnitude) + 2) * 10)))
        color = 16 if bp_rp is None else max(0, min(31, round((float(bp_rp) + 0.6) / 5 * 31)))
        records.extend(SMP3_RECORD.pack(qx, qy, mag, color, 0, 0))
        if include_ids:
            ids.extend(struct.pack("<Q", source_id))
    payload = SMP3_HEADER.pack(
        SMP3_MAGIC, SMP3_VERSION, SMP3_FLAG_SOURCE_IDS if include_ids else 0,
        origin_x, origin_y, span, len(rows),
    ) + records + ids
    offset = container.tell()
    container.write(payload)
    index.write(SMPK1_ENTRY.pack(key.span_log2, key.x, key.y, offset, len(payload)))


if __name__ == "__main__":
    raise SystemExit(main())
