#!/usr/bin/env python3
"""Measure a complete DESI row-locator and angular R-tree component.

The R-tree stores float bounding candidates. Queries must filter candidates
against the exact double coordinates in ``positions``. Rows without valid sky
coordinates remain in the owned detail store and are counted separately.
"""
import argparse
import fcntl
import json
import math
from pathlib import Path
import sqlite3
import time

import pyarrow.parquet as pq

from measure_gaia_full_partitions import guard, save, sha


FORMAT = "desi-exact-angular-sqlite-v1"
OWNER = "SkyChart isolated DESI angular measurement 1271\n"


def ordered_partitions(audit):
    parts = sorted(audit["partitions"], key=lambda row: row["source_start"])
    stop = 0
    for slot, part in enumerate(parts):
        if part["hdu"] != 1 or part["source_start"] != stop:
            raise ValueError("DESI partitions have a gap, overlap or unexpected HDU")
        if part["source_stop"] - part["source_start"] != part["rows"]:
            raise ValueError("DESI partition row interval mismatch")
        if not part["all_fields_verified"]:
            raise ValueError("unverified DESI partition")
        stop = part["source_stop"]
        yield slot, part
    if stop != audit["rows"] or audit["rows"] != audit["expected_rows"]:
        raise ValueError("DESI full row accounting mismatch")


def valid_position(ra, dec):
    return (
        ra is not None
        and dec is not None
        and math.isfinite(ra)
        and math.isfinite(dec)
        and 0 <= ra < 360
        and -90 <= dec <= 90
    )


def measure(source, output, floor=60 * (1 << 30)):
    audit_path = source / "measurement.json"
    audit = json.loads(audit_path.read_text())
    if audit["status"] != "FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED":
        raise ValueError("complete partitioned DESI detail is required")
    parts = list(ordered_partitions(audit))
    for _, part in parts:
        if sha(source / part["file"]) != part["sha256"]:
            raise ValueError("verified DESI partition changed")

    output.mkdir(parents=True, exist_ok=True)
    lock = (output / ".lock").open("w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    owner = output / "OWNER"
    if owner.exists():
        if owner.read_text() != OWNER:
            raise ValueError("unowned output")
    else:
        if any(path.name != ".lock" for path in output.iterdir()):
            raise ValueError("nonempty unowned output")
        owner.write_text(OWNER)

    pin = {
        "format": FORMAT,
        "detail_measurement_sha256": sha(audit_path),
        "source_sha256": audit["source_sha256"],
        "coordinate_fields": ["TARGET_RA", "TARGET_DEC"],
        "locator": "source row ordinal plus partition/row-group/offset",
    }
    manifest = output / "manifest.json"
    if manifest.exists():
        if json.loads(manifest.read_text()) != pin:
            raise ValueError("DESI angular contract changed")
    else:
        save(manifest, pin)

    index = output / "angular.sqlite"
    result_path = output / "measurement.json"
    if result_path.exists():
        result = json.loads(result_path.read_text())
        if sha(index) != result["sha256"]:
            raise ValueError("completed DESI angular index changed")
        return result

    started = time.monotonic()
    with sqlite3.connect(index) as db:
        db.executescript(
            """PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS release(
              format TEXT PRIMARY KEY, detail_measurement_sha256 TEXT NOT NULL,
              source_sha256 TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS files(
              slot INTEGER PRIMARY KEY, file TEXT UNIQUE NOT NULL,
              partition_sha256 TEXT NOT NULL, source_start INTEGER NOT NULL,
              source_stop INTEGER NOT NULL, rows INTEGER NOT NULL,
              angular_rows INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS positions(
              ordinal INTEGER PRIMARY KEY, slot INTEGER NOT NULL,
              row_group INTEGER NOT NULL, row_offset INTEGER NOT NULL,
              ra REAL NOT NULL, dec REAL NOT NULL);
            CREATE VIRTUAL TABLE IF NOT EXISTS angular USING rtree(
              ordinal,min_ra,max_ra,min_dec,max_dec);
            """
        )
        old = db.execute(
            "SELECT format,detail_measurement_sha256,source_sha256 FROM release"
        ).fetchall()
        expected_release = [(FORMAT, pin["detail_measurement_sha256"], pin["source_sha256"])]
        if old and old != expected_release:
            raise ValueError("DESI angular release changed")
        db.execute("INSERT OR IGNORE INTO release VALUES (?,?,?)", expected_release[0])
        db.commit()

        for slot, part in parts:
            prior = db.execute(
                "SELECT partition_sha256,source_start,source_stop,rows FROM files WHERE slot=?",
                (slot,),
            ).fetchone()
            expected_file = (
                part["sha256"],
                part["source_start"],
                part["source_stop"],
                part["rows"],
            )
            if prior:
                if prior != expected_file:
                    raise ValueError("completed DESI angular partition changed")
                continue

            guard(output, floor)
            parquet = pq.ParquetFile(source / part["file"])
            rows = angular_rows = 0
            with db:
                for group in range(parquet.num_row_groups):
                    table = parquet.read_row_group(
                        group, columns=["TARGET_RA", "TARGET_DEC"], use_threads=False
                    )
                    positions = []
                    bounds = []
                    for offset, row in enumerate(table.to_pylist()):
                        ra, dec = row["TARGET_RA"], row["TARGET_DEC"]
                        if valid_position(ra, dec):
                            ordinal = part["source_start"] + rows + offset
                            positions.append((ordinal, slot, group, offset, ra, dec))
                            bounds.append((ordinal, ra, ra, dec, dec))
                    db.executemany("INSERT INTO positions VALUES (?,?,?,?,?,?)", positions)
                    db.executemany("INSERT INTO angular VALUES (?,?,?,?,?)", bounds)
                    rows += table.num_rows
                    angular_rows += len(positions)
                    guard(output, floor)
                if rows != part["rows"]:
                    raise ValueError("DESI angular partition row count mismatch")
                db.execute(
                    "INSERT INTO files VALUES (?,?,?,?,?,?,?)",
                    (
                        slot,
                        part["file"],
                        part["sha256"],
                        part["source_start"],
                        part["source_stop"],
                        rows,
                        angular_rows,
                    ),
                )

            joined = db.execute(
                """SELECT count(*) FROM positions p JOIN angular a USING(ordinal)
                   WHERE p.slot=? AND p.ra>=a.min_ra AND p.ra<=a.max_ra
                     AND p.dec>=a.min_dec AND p.dec<=a.max_dec""",
                (slot,),
            ).fetchone()[0]
            if joined != angular_rows:
                raise ValueError("DESI exact/angular locator verification failed")
            committed, accounted, positioned = db.execute(
                "SELECT count(*),sum(rows),sum(angular_rows) FROM files"
            ).fetchone()
            save(
                output / "progress.json",
                {
                    "status": "BUILDING_AND_VERIFYING_ANGULAR_INDEX",
                    "committed_partitions": committed,
                    "expected_partitions": len(parts),
                    "accounted_rows": accounted,
                    "angular_rows": positioned,
                    "logical_bytes": index.stat().st_size,
                    "full_serving_bytes": None,
                },
            )

        files, rows, angular_rows = db.execute(
            "SELECT count(*),coalesce(sum(rows),0),coalesce(sum(angular_rows),0) FROM files"
        ).fetchone()
        if files != len(parts) or rows != audit["rows"]:
            raise ValueError("DESI full angular accounting failed")
        if db.execute("SELECT count(*) FROM positions").fetchone()[0] != angular_rows:
            raise ValueError("DESI exact position count mismatch")
        if db.execute("SELECT count(*) FROM angular").fetchone()[0] != angular_rows:
            raise ValueError("DESI R-tree count mismatch")
        if db.execute("SELECT rtreecheck(?)", ("angular",)).fetchone()[0] != "ok":
            raise ValueError("DESI angular R-tree corrupt")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("DESI angular SQLite corrupt")

    result = {
        "format": FORMAT,
        "status": "COMPLETE_COMPONENT",
        "partitions": files,
        "rows": rows,
        "angular_rows": angular_rows,
        "rows_without_valid_angular_position": rows - angular_rows,
        "logical_bytes": index.stat().st_size,
        "allocated_bytes": index.stat().st_blocks * 512,
        "sha256": sha(index),
        "seconds_current_invocation": time.monotonic() - started,
        "all_stored_angular_locators_verified": True,
        "full_serving_bytes": None,
        "remaining": [
            "native rendering tiles",
            "cross-identification evidence",
            "native API integration and latency budgets",
        ],
    }
    save(result_path, result)
    save(output / "progress.json", {"status": result["status"]})
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--free-floor-gib", type=int, default=60)
    args = parser.parse_args()
    print(json.dumps(measure(args.source, args.output, args.free_floor_gib * (1 << 30))))
