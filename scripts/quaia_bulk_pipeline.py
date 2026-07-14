#!/usr/bin/env python3
"""Project and de-duplicate the real all-sky Quaia G<20.0 catalog.

Quaia positions are measured, while its distances use published
spectrophotometric/ML redshift estimates.  The metadata emitted beside the
Parquet file preserves that distinction; the layer must never be labelled as
spectroscopic.  Run offline on the workstation, never on the app host.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from desi_bulk_pipeline import (  # noqa: E402
    AU_PER_MPC,
    OBLIQUITY_DEG,
    SOURCE_SHA256 as DESI_SOURCE_SHA256,
    comoving_distance_grid,
    cosmology_metadata,
    encode,
    parquet_source,
    partition,
    refuse_application_host,
    require_duckdb,
    sql_path,
)

SOURCE_URL = "https://zenodo.org/records/10403370/files/quaia_G20.0.fits"
SOURCE_DOI = "10.5281/zenodo.10403370"
SOURCE_MD5 = "72531bc67bde1b08a69d5aeae03fb26e"
SOURCE_LICENSE = "CC BY 4.0"
EXPECTED_SOURCE_COUNT = 755_850
MAX_REDSHIFT = 8.0
MATCH_ARCSEC = 1.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    project_parser = subparsers.add_parser("project")
    project_parser.add_argument("--input", type=Path, required=True)
    project_parser.add_argument("--output", type=Path, required=True)
    project_parser.add_argument("--chunk-rows", type=int, default=250_000)
    dedup_parser = subparsers.add_parser("deduplicate-desi")
    dedup_parser.add_argument("--input", type=Path, required=True)
    dedup_parser.add_argument("--desi-reference", type=Path, required=True)
    dedup_parser.add_argument("--output", type=Path, required=True)
    for command in ("partition", "encode"):
        build_parser = subparsers.add_parser(command)
        build_parser.add_argument("--input", type=Path, required=True)
        build_parser.add_argument("--output", type=Path, required=True)
        build_parser.add_argument("--temp-directory", type=Path)
        build_parser.add_argument("--memory-limit", default="24GB")
        build_parser.add_argument("--threads", type=int, default=8)
        if command == "encode":
            build_parser.add_argument("--version", required=True)
    args = parser.parse_args()
    refuse_application_host()
    if args.command == "project":
        return project_fits(args.input, args.output, args.chunk_rows)
    if args.command == "deduplicate-desi":
        return deduplicate_desi(args.input, args.desi_reference, args.output)
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
    return encode(connection, args.input, args.output, args.version)


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
    selected = rejected = 0
    with fitsio.FITS(source) as fits:
        table = fits[1]
        names = {name.lower(): name for name in table.get_colnames()}
        required = {
            "source_id", "ra", "dec", "redshift_quaia",
            "redshift_quaia_err", "phot_g_mean_mag",
        }
        missing = sorted(required - names.keys())
        if missing:
            raise RuntimeError(f"Quaia FITS is missing required columns: {', '.join(missing)}")
        columns = [names[name] for name in sorted(required)]
        z_grid, distance_grid = comoving_distance_grid(np)
        cos_eps = math.cos(math.radians(OBLIQUITY_DEG))
        sin_eps = math.sin(math.radians(OBLIQUITY_DEG))
        for start in range(0, table.get_nrows(), chunk_rows):
            stop = min(table.get_nrows(), start + chunk_rows)
            batch = table.read(columns=columns, rows=np.arange(start, stop, dtype=np.int64))
            values = {name: batch[actual] for name, actual in names.items() if actual in columns}
            ra_deg = values["ra"].astype(np.float64)
            dec_deg = values["dec"].astype(np.float64)
            redshift = values["redshift_quaia"].astype(np.float64)
            redshift_err = values["redshift_quaia_err"].astype(np.float64)
            magnitude = values["phot_g_mean_mag"].astype(np.float32)
            mask = (
                np.isfinite(ra_deg) & (ra_deg >= 0) & (ra_deg < 360)
                & np.isfinite(dec_deg) & (dec_deg >= -90) & (dec_deg <= 90)
                & np.isfinite(redshift) & (redshift > 0) & (redshift <= MAX_REDSHIFT)
                & np.isfinite(redshift_err) & (redshift_err >= 0)
            )
            rejected += int(np.count_nonzero(~mask))
            if not np.any(mask):
                continue
            ids = values["source_id"][mask].astype(np.uint64)
            ra_deg = ra_deg[mask]
            dec_deg = dec_deg[mask]
            redshift = redshift[mask]
            redshift_err = redshift_err[mask]
            magnitude = magnitude[mask]
            ra = np.radians(ra_deg)
            dec = np.radians(dec_deg)
            distance_mpc = np.interp(redshift, z_grid, distance_grid)
            radius_au = distance_mpc * AU_PER_MPC
            cos_dec = np.cos(dec)
            equatorial_x = radius_au * cos_dec * np.cos(ra)
            equatorial_y = radius_au * cos_dec * np.sin(ra)
            equatorial_z = radius_au * np.sin(dec)
            projected = pa.table({
                "target_id": ids,
                "ra_deg": ra_deg,
                "dec_deg": dec_deg,
                "redshift": redshift,
                "redshift_error": redshift_err,
                "distance_mpc": distance_mpc,
                "x_au": equatorial_x,
                "y_au": cos_eps * equatorial_y + sin_eps * equatorial_z,
                "z_au": -sin_eps * equatorial_y + cos_eps * equatorial_z,
                "magnitude": magnitude,
                "type_code": np.full(len(ids), 3, dtype=np.uint8),
                "color_idx": np.full(len(ids), 244, dtype=np.uint8),
            })
            if writer is None:
                writer = pq.ParquetWriter(temporary, projected.schema, compression="zstd")
            writer.write_table(projected, row_group_size=122_880)
            selected += len(ids)
    if writer is None:
        raise RuntimeError("Quaia projection selected no rows")
    writer.close()
    temporary.replace(output)
    metadata = release_metadata(selected, rejected)
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"selected": selected, "rejected": rejected}, indent=2))
    return 0


def release_metadata(selected: int, rejected: int) -> dict:
    return {
        "layer_id": "quaia_g20",
        "container_name": "quaia_g20.smpk",
        "groups": ["quaia_g20_quasars"],
        "types": ["quasar"],
        "source": {
            "url": SOURCE_URL,
            "doi": SOURCE_DOI,
            "md5": SOURCE_MD5,
            "license": SOURCE_LICENSE,
        },
        "selection": {
            "catalog_release": "Quaia G<20.0",
            "quality": "cleaner published G<20.0 sample; finite coordinates, redshift estimate, and uncertainty",
            "distance_quality": "inferred_spectrophotometric_ml_redshift",
            "distance_warning": "Not a spectroscopic distance; retain and expose redshift_error.",
            "expected_source_count": EXPECTED_SOURCE_COUNT,
            "selected_source_count": selected,
            "rejected_source_count": rejected,
        },
        "source_counts": {"quaia_g20_quasars": selected},
        "cosmology": cosmology_metadata(),
        "projection": "comoving_ecliptic_top_down_au",
        "deduplication": {
            "priority": ["desi_dr1_spectroscopic", "quaia_g20_spectrophotometric"],
            "rule": f"remove Quaia row within {MATCH_ARCSEC} arcsec of a DESI row",
        },
    }


def deduplicate_desi(source: Path, desi_reference: Path, output: Path) -> int:
    """Prefer DESI spectroscopy for positional matches, deterministically."""

    duckdb = require_duckdb()
    connection = duckdb.connect()
    cell = math.radians(2.0 / 3600.0)
    threshold = math.cos(math.radians(MATCH_ARCSEC / 3600.0))
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    connection.execute(f"""
        COPY (
          WITH q0 AS (
            SELECT *, sqrt(x_au*x_au + y_au*y_au + z_au*z_au) radius_au
            FROM {parquet_source(source)}
          ), q AS (
            SELECT * EXCLUDE (radius_au), x_au/radius_au ux,
              y_au/radius_au uy, z_au/radius_au uz FROM q0
            WHERE radius_au > 0
          ), d0 AS (
            SELECT target_id, x_au, y_au, z_au,
              sqrt(x_au*x_au + y_au*y_au + z_au*z_au) radius_au
            FROM {parquet_source(desi_reference)}
          ), d AS (
            SELECT target_id, x_au/radius_au ux, y_au/radius_au uy,
              z_au/radius_au uz FROM d0 WHERE radius_au > 0
          ), db AS (
            SELECT *, floor(ux/{cell})::BIGINT bin_x, floor(uy/{cell})::BIGINT bin_y,
              floor(uz/{cell})::BIGINT bin_z FROM d
          ), matches AS (
            SELECT DISTINCT q.target_id
            FROM q
            CROSS JOIN range(-1, 2) dx
            CROSS JOIN range(-1, 2) dy
            CROSS JOIN range(-1, 2) dz
            JOIN db ON db.bin_x=floor(q.ux/{cell})::BIGINT+dx.range
              AND db.bin_y=floor(q.uy/{cell})::BIGINT+dy.range
              AND db.bin_z=floor(q.uz/{cell})::BIGINT+dz.range
            WHERE q.ux*db.ux + q.uy*db.uy + q.uz*db.uz >= {threshold}
          )
          SELECT q.* EXCLUDE (ux, uy, uz) FROM q ANTI JOIN matches USING (target_id)
          ORDER BY target_id
        ) TO '{sql_path(temporary)}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)
    """)
    temporary.replace(output)
    input_count = connection.execute(f"SELECT count(*) FROM {parquet_source(source)}").fetchone()[0]
    output_count = connection.execute(f"SELECT count(*) FROM {parquet_source(output)}").fetchone()[0]
    metadata_path = source.with_suffix(".json")
    metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else release_metadata(input_count, 0)
    desi_metadata_path = desi_reference.with_suffix(".json")
    desi_metadata = json.loads(desi_metadata_path.read_text()) if desi_metadata_path.exists() else {}
    metadata["deduplication"].update({
        "desi_reference": {
            "catalog": "DESI DR1 zcatalog v1 projected artifact",
            "source_sha256": desi_metadata.get("source_sha256", DESI_SOURCE_SHA256),
        },
        "input_count": input_count,
        "removed_as_desi_matches": input_count - output_count,
        "output_count": output_count,
    })
    metadata["source_counts"] = {"quaia_g20_quasars": output_count}
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata["deduplication"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
