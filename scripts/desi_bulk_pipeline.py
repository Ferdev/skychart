#!/usr/bin/env python3
"""Build a real DESI DR1 galaxy/quasar point pyramid for Cosmic Atlas.

Run this offline on the workstation, never on the application host. The
pipeline reads the official DESI DR1 zcatalog v1 FITS summary, keeps unique
successful galaxy and quasar redshifts, converts them to comoving ecliptic
Cartesian coordinates, and emits one Range-readable SMPK1 container.
"""

from __future__ import annotations

import argparse
import json
import math
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

SOURCE_URL = "https://data.desi.lbl.gov/public/dr1/spectro/redux/iron/zcatalog/v1/zall-pix-iron.fits"
SOURCE_LICENSE = "CC BY 4.0"
SOURCE_SHA256 = "2d95ad99361039b556c402b49e0e7c84df5f00106dc5731d44476a58b128b49b"
AU_PER_PC = 206_264.80624709636
AU_PER_MPC = AU_PER_PC * 1_000_000
C_KM_S = 299_792.458
H0_KM_S_MPC = 67.66
OMEGA_M = 0.30966
OMEGA_LAMBDA = 1.0 - OMEGA_M
OBLIQUITY_DEG = 23.43928
MIN_REDSHIFT = 0.0001
# ``target_points`` is a level-wide target, not a per-tile quota.  Keeping one
# deterministic hash fraction across every tile preserves the measured DESI
# density field.  The old 12--24k coarse-level caps selected the hash fraction
# from the single densest tile and accidentally reduced the *whole* Universe
# level to only 23--95k records.  Coarse levels now target enough real records
# to populate a normal viewport while retaining a generous per-tile guardrail.
# ``None`` retains the density-limited behavior used by the detailed levels.
LEVELS = (
    (44, 40_000, None),
    (46, 30_000, None),
    (48, 800_000, 1_500_000),
    (50, 800_000, 1_500_000),
    (52, 800_000, 1_500_000),
    (54, 800_000, 1_500_000),
)
SOURCE_ID_LEVELS = {level for level, _, _ in LEVELS}
HASH_BUCKET_COUNT = 1_048_576
DENSITY_SAMPLE_HEADROOM = 0.72
TYPE_CODES = {"GALAXY": 1, "QSO": 3}
COLOR_INDICES = {"GALAXY": 240, "QSO": 242}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("project", "partition", "encode"))
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", default="")
    parser.add_argument("--chunk-rows", type=int, default=500_000)
    parser.add_argument("--temp-directory", type=Path)
    parser.add_argument("--memory-limit", default="24GB")
    parser.add_argument("--threads", type=int, default=8)
    args = parser.parse_args()
    refuse_application_host()
    if args.command == "project":
        return project_fits(args.input, args.output, args.chunk_rows)

    duckdb = require_duckdb()
    connection = duckdb.connect()
    connection.execute("SET preserve_insertion_order=false")
    temp_directory = args.temp_directory or args.output.parent / ".duckdb-tmp"
    temp_directory.mkdir(parents=True, exist_ok=True)
    connection.execute(f"SET temp_directory='{sql_path(temp_directory)}'")
    connection.execute(f"SET memory_limit='{args.memory_limit}'")
    connection.execute(f"SET threads={args.threads}")
    connection.execute("SET enable_progress_bar=true")
    if args.command == "partition":
        return partition(connection, args.input, args.output)
    return encode(connection, args.input, args.output, args.version or args.output.name)


def refuse_application_host() -> None:
    if os.environ.get("SKYCHART_APPLICATION_HOST") == "1":
        raise SystemExit("Refusing to run the DESI bulk pipeline on the application host.")
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
        raise SystemExit("Install scripts/desi_bulk_requirements.txt in the offline build environment.") from error


def project_fits(source: Path, output: Path, chunk_rows: int) -> int:
    try:
        import fitsio
        import numpy as np
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as error:
        raise SystemExit("Install scripts/desi_bulk_requirements.txt in the offline build environment.") from error

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    writer = None
    selected = {"GALAXY": 0, "QSO": 0}
    scanned = 0
    with fitsio.FITS(source) as fits:
        table = fits[1]
        available = set(table.get_colnames())
        required = {"TARGETID", "TARGET_RA", "TARGET_DEC", "Z", "ZWARN", "SPECTYPE", "OBJTYPE", "SURVEY", "ZCAT_PRIMARY"}
        missing = sorted(required - available)
        if missing:
            raise RuntimeError(f"DESI ZCATALOG is missing required columns: {', '.join(missing)}")
        columns = sorted(required | ({"FLUX_R"} if "FLUX_R" in available else set()))
        rows = table.get_nrows()
        z_grid, distance_grid = comoving_distance_grid(np)
        cos_eps = math.cos(math.radians(OBLIQUITY_DEG))
        sin_eps = math.sin(math.radians(OBLIQUITY_DEG))
        for start in range(0, rows, chunk_rows):
            stop = min(rows, start + chunk_rows)
            batch = table.read(columns=columns, rows=np.arange(start, stop, dtype=np.int64))
            scanned += len(batch)
            spectype = np.char.strip(batch["SPECTYPE"].astype("U"))
            objtype = np.char.strip(batch["OBJTYPE"].astype("U"))
            survey = np.char.strip(batch["SURVEY"].astype("U"))
            redshift = batch["Z"].astype(np.float64)
            mask = (
                batch["ZCAT_PRIMARY"].astype(bool)
                & (survey == "main")
                & (batch["ZWARN"] == 0)
                & (objtype == "TGT")
                & np.isin(spectype, ("GALAXY", "QSO"))
                & np.isfinite(redshift)
                & (redshift >= MIN_REDSHIFT)
                & (redshift <= z_grid[-1])
            )
            if not np.any(mask):
                continue
            ids = batch["TARGETID"][mask].astype(np.uint64)
            kinds = spectype[mask]
            z = redshift[mask]
            ra = np.radians(batch["TARGET_RA"][mask].astype(np.float64))
            dec = np.radians(batch["TARGET_DEC"][mask].astype(np.float64))
            distance_mpc = np.interp(z, z_grid, distance_grid)
            radius_au = distance_mpc * AU_PER_MPC
            cos_dec = np.cos(dec)
            equatorial_x = radius_au * cos_dec * np.cos(ra)
            equatorial_y = radius_au * cos_dec * np.sin(ra)
            equatorial_z = radius_au * np.sin(dec)
            x_au = equatorial_x
            y_au = cos_eps * equatorial_y + sin_eps * equatorial_z
            z_au = -sin_eps * equatorial_y + cos_eps * equatorial_z
            magnitude = np.full(len(ids), np.nan, dtype=np.float32)
            if "FLUX_R" in available:
                flux = batch["FLUX_R"][mask].astype(np.float64)
                valid_flux = np.isfinite(flux) & (flux > 0)
                magnitude[valid_flux] = (22.5 - 2.5 * np.log10(flux[valid_flux])).astype(np.float32)
            type_code = np.where(kinds == "GALAXY", TYPE_CODES["GALAXY"], TYPE_CODES["QSO"]).astype(np.uint8)
            color_idx = np.where(kinds == "GALAXY", COLOR_INDICES["GALAXY"], COLOR_INDICES["QSO"]).astype(np.uint8)
            table_out = pa.table({
                "target_id": ids,
                "ra_deg": batch["TARGET_RA"][mask].astype(np.float64),
                "dec_deg": batch["TARGET_DEC"][mask].astype(np.float64),
                "redshift": z,
                "distance_mpc": distance_mpc,
                "x_au": x_au,
                "y_au": y_au,
                "z_au": z_au,
                "magnitude": magnitude,
                "type_code": type_code,
                "color_idx": color_idx,
            })
            if writer is None:
                writer = pq.ParquetWriter(temporary, table_out.schema, compression="zstd")
            writer.write_table(table_out, row_group_size=122_880)
            for kind in selected:
                selected[kind] += int(np.count_nonzero(kinds == kind))
            print(f"Scanned {scanned:,}/{rows:,}; selected {sum(selected.values()):,}", flush=True)
    if writer is None:
        raise RuntimeError("DESI projection selected no rows")
    writer.close()
    temporary.replace(output)
    metadata = {
        "source_url": SOURCE_URL,
        "source_sha256": SOURCE_SHA256,
        "source_license": SOURCE_LICENSE,
        "selection": "SURVEY == main && ZCAT_PRIMARY && ZWARN == 0 && OBJTYPE == TGT && SPECTYPE in (GALAXY,QSO) && Z >= 0.0001",
        "source_counts": {"desi_dr1_galaxies": selected["GALAXY"], "desi_dr1_quasars": selected["QSO"]},
        "cosmology": cosmology_metadata(),
        "projection": "comoving_ecliptic_top_down_au",
    }
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata["source_counts"], indent=2))
    return 0


def comoving_distance_grid(np):
    z_grid = np.linspace(0.0, 8.0, 400_001, dtype=np.float64)
    inverse_e = 1.0 / np.sqrt(OMEGA_M * (1.0 + z_grid) ** 3 + OMEGA_LAMBDA)
    distance = np.empty_like(z_grid)
    distance[0] = 0.0
    dz = z_grid[1] - z_grid[0]
    distance[1:] = np.cumsum((inverse_e[:-1] + inverse_e[1:]) * 0.5 * dz)
    distance *= C_KM_S / H0_KM_S_MPC
    return z_grid, distance


def cosmology_metadata() -> dict:
    return {
        "model": "flat LambdaCDM",
        "distance": "line-of-sight comoving distance",
        "H0_km_s_Mpc": H0_KM_S_MPC,
        "Omega_m": OMEGA_M,
        "Omega_lambda": OMEGA_LAMBDA,
        "redshift_grid_step": 8.0 / 400_000,
    }


def parquet_source(path: Path | str) -> str:
    return f"read_parquet('{sql_path(path)}', union_by_name=true, hive_partitioning=true)"


def sql_path(path: Path | str) -> str:
    return str(path).replace("'", "''")


def sample_buckets_for_level(
    *,
    source_count: int,
    raw_max: int,
    cap: int,
    target_points: int | None,
) -> int:
    """Return one deterministic hash fraction for a complete pyramid level.

    A single fraction across all tiles preserves relative survey density.  The
    per-tile cap is only a safety constraint; target_points controls the total
    coarse-level payload.  Integer buckets make rebuilds byte-deterministic for
    an unchanged projected source table.
    """

    if source_count <= 0 or raw_max <= 0 or cap <= 0:
        return 1
    cap_fraction = DENSITY_SAMPLE_HEADROOM * cap / raw_max
    target_fraction = 1.0 if target_points is None else target_points / source_count
    fraction = min(1.0, cap_fraction, target_fraction)
    return min(HASH_BUCKET_COUNT, max(1, int(HASH_BUCKET_COUNT * fraction)))


def partition(connection, source: Path, output: Path) -> int:
    output.mkdir(parents=True, exist_ok=True)
    source_relation = parquet_source(source)
    metadata_path = source.with_suffix(".json")
    source_metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
    source_count = int(connection.execute(f"SELECT count(*) FROM {source_relation}").fetchone()[0])
    level_metadata = []
    for level, cap, target_points in LEVELS:
        span = 2**level
        connection.execute("DROP TABLE IF EXISTS raw_tile_counts")
        connection.execute(f"""
            CREATE TEMP TABLE raw_tile_counts AS
            SELECT floor(x_au / {span})::INTEGER tile_x,
              floor(y_au / {span})::INTEGER tile_y,
              count(*)::BIGINT raw_tile_count
            FROM {source_relation}
            GROUP BY tile_x, tile_y
        """)
        raw_max, raw_tile_count = connection.execute(
            "SELECT coalesce(max(raw_tile_count), 0), count(*) FROM raw_tile_counts"
        ).fetchone()
        raw_max = int(raw_max)
        sample_buckets = sample_buckets_for_level(
            source_count=source_count,
            raw_max=raw_max,
            cap=cap,
            target_points=target_points,
        )
        destination = output / f"level={level}" / "data.parquet"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.unlink(missing_ok=True)
        print(
            f"Level {level}: {int(raw_tile_count):,} raw tiles, max {raw_max:,}, "
            f"sample {sample_buckets}/{HASH_BUCKET_COUNT}",
            flush=True,
        )
        connection.execute(f"""
            COPY (
              WITH sampled AS (
                SELECT {level}::INTEGER AS level, raw.tile_x, raw.tile_y,
                  points.x_au, points.y_au, points.magnitude, points.type_code,
                  points.color_idx, points.target_id, raw.raw_tile_count,
                  {sample_buckets}::BIGINT sample_buckets
                FROM {source_relation} points
                JOIN raw_tile_counts raw
                  ON raw.tile_x = floor(points.x_au / {span})::INTEGER
                 AND raw.tile_y = floor(points.y_au / {span})::INTEGER
                WHERE (hash(points.target_id) % {HASH_BUCKET_COUNT}) < {sample_buckets}
              ), ranked AS (
                SELECT *,
                  count(*) OVER (PARTITION BY tile_x, tile_y)::BIGINT sampled_tile_count,
                  row_number() OVER (
                    PARTITION BY tile_x, tile_y
                    ORDER BY magnitude ASC NULLS LAST, target_id ASC
                  ) AS rank
                FROM sampled
              )
              SELECT level, tile_x, tile_y, x_au, y_au, magnitude, type_code,
                color_idx, target_id, raw_tile_count, sampled_tile_count,
                sample_buckets, {HASH_BUCKET_COUNT}::BIGINT sample_bucket_count
              FROM ranked WHERE rank <= {cap}
              ORDER BY tile_x, tile_y, magnitude ASC NULLS LAST, target_id ASC
            ) TO '{sql_path(destination)}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)
        """)
        level_metadata.append({
            "level": level,
            "raw_tile_count": int(raw_tile_count),
            "raw_max_points_per_tile": raw_max,
            "sample_buckets": sample_buckets,
            "sample_bucket_count": HASH_BUCKET_COUNT,
            "target_points": target_points,
        })
    (output / "build.json").write_text(json.dumps({
        **source_metadata,
        "selected_source_count": source_count,
        "levels": LEVELS,
        "level_metadata": level_metadata,
        "sampling": {
            "method": "level-wide deterministic target-id hash with optional global point target",
            "bucket_count": HASH_BUCKET_COUNT,
            "headroom": DENSITY_SAMPLE_HEADROOM,
        },
    }, indent=2) + "\n")
    return 0


def encode(connection, source: Path, output: Path, version: str) -> int:
    output.mkdir(parents=True, exist_ok=True)
    build = json.loads((source / "build.json").read_text())
    layer_id = build.get("layer_id", "desi_dr1")
    container_name = build.get("container_name", f"{layer_id}.smpk")
    manifest_levels = []
    metadata_by_level = {}
    total_tile_count = 0
    for level, cap, target_points in LEVELS:
        pattern = source / f"level={level}" / "*.parquet"
        metadata = connection.execute(
            f"SELECT max(sample_buckets), max(sample_bucket_count), sum(raw_tile_count), "
            f"max(raw_tile_count), max(sampled_tile_count), count(*) FROM "
            f"(SELECT DISTINCT tile_x, tile_y, raw_tile_count, sampled_tile_count, "
            f"sample_buckets, sample_bucket_count FROM {parquet_source(pattern)})"
        ).fetchone()
        if int(metadata[4] or 0) >= cap:
            raise RuntimeError(f"DESI density sample saturated level {level}: {int(metadata[4])} >= {cap}")
        metadata_by_level[level] = metadata
        total_tile_count += int(metadata[5] or 0)

    with tempfile.TemporaryDirectory(prefix="skychart-desi-smp3-") as scratch:
        index_path = Path(scratch) / "desi_dr1.index"
        container_path = output / container_name
        data_offset = SMPK1_HEADER.size + total_tile_count * SMPK1_ENTRY.size
        actual_tile_count = 0
        with container_path.open("w+b") as container, index_path.open("wb") as index:
            container.write(SMPK1_HEADER.pack(SMPK1_MAGIC, 1, total_tile_count))
            container.seek(data_offset)
            for level, cap, target_points in LEVELS:
                metadata = metadata_by_level[level]
                pattern = source / f"level={level}" / "*.parquet"
                cursor = connection.execute(
                    f"SELECT tile_x, tile_y, x_au, y_au, magnitude, type_code, color_idx, target_id "
                    f"FROM {parquet_source(pattern)} "
                    f"ORDER BY tile_x, tile_y, magnitude ASC NULLS LAST, target_id"
                )
                current_key = None
                rows = []
                point_count = 0
                tile_count = 0
                while batch := cursor.fetchmany(100_000):
                    for tile_x, tile_y, x_au, y_au, magnitude, type_code, color_idx, target_id in batch:
                        key = TileKey(level, int(tile_x), int(tile_y))
                        if current_key is not None and key != current_key:
                            write_tile(container, index, current_key, rows, level in SOURCE_ID_LEVELS)
                            tile_count += 1
                            actual_tile_count += 1
                            rows = []
                        current_key = key
                        rows.append((float(x_au), float(y_au), magnitude, int(type_code), int(color_idx), int(target_id)))
                        point_count += 1
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
                    "point_count": point_count,
                    "raw_point_count": int(build["selected_source_count"]),
                    "raw_max_points_per_tile": int(metadata[3] or 0),
                    "sample_buckets": int(metadata[0] or HASH_BUCKET_COUNT),
                    "sample_bucket_count": int(metadata[1] or HASH_BUCKET_COUNT),
                    "target_points": target_points,
                })
            if actual_tile_count != total_tile_count:
                raise RuntimeError("DESI container tile count changed during encode")
            index.flush()
            container.seek(SMPK1_HEADER.size)
            with index_path.open("rb") as index_source:
                shutil.copyfileobj(index_source, container, 8 * 1024 * 1024)

    source_counts = build.get("source_counts", {})
    manifest = {
        "version": version,
        "format": "SMP3",
        "container_format": "SMPK1",
        "records_sorted_by": "magnitude",
        "record_bytes": 8,
        "projection": "comoving_ecliptic_top_down_au",
        "source": build.get(
            "source",
            {"url": SOURCE_URL, "sha256": SOURCE_SHA256, "license": SOURCE_LICENSE},
        ),
        "selection": build.get("selection"),
        "cosmology": build.get("cosmology", cosmology_metadata()),
        "deduplication": build.get("deduplication"),
        "source_counts": source_counts,
        "layers": [{
            "id": layer_id,
            "groups": build.get("groups", ["desi_dr1_galaxies", "desi_dr1_quasars"]),
            "types": build.get("types", ["galaxy", "quasar"]),
            "source_counts": source_counts,
            "container": container_name,
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
    for x, y, magnitude, type_code, color_idx, target_id in rows:
        qx = max(0, min(65_535, round((x - origin_x) / span * 65_535)))
        qy = max(0, min(65_535, round((y - origin_y) / span * 65_535)))
        mag = 255 if magnitude is None or not math.isfinite(float(magnitude)) else max(0, min(255, round((float(magnitude) + 2) * 10)))
        records.extend(SMP3_RECORD.pack(qx, qy, mag, color_idx, type_code, 0))
        if include_ids:
            ids.extend(struct.pack("<Q", target_id))
    payload = SMP3_HEADER.pack(
        SMP3_MAGIC,
        SMP3_VERSION,
        SMP3_FLAG_SOURCE_IDS if include_ids else 0,
        origin_x,
        origin_y,
        span,
        len(rows),
    ) + records + ids
    offset = container.tell()
    container.write(payload)
    index.write(SMPK1_ENTRY.pack(key.span_log2, key.x, key.y, offset, len(payload)))


if __name__ == "__main__":
    raise SystemExit(main())
