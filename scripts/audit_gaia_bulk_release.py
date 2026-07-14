#!/usr/bin/env python3
"""Audit random Gaia SMP3 records against the source Parquet corpus."""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smp3 import (
    SMP3_FLAG_SOURCE_IDS,
    SMP3_HEADER,
    SMP3_HEADER_BYTES,
    SMP3_MAGIC,
    SMP3_RECORD,
    SMP3_RECORD_BYTES,
    SMPK1_HEADER,
    read_container_index,
)

AU_PER_PC = 206_264.80624709636
OBLIQUITY_RADIANS = math.radians(23.43928)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source", required=True, help="Source Parquet glob")
    parser.add_argument("--sample-size", type=int, default=1_000)
    parser.add_argument("--seed", type=int, default=2_026_071_3)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if args.sample_size <= 0:
        parser.error("--sample-size must be positive")

    manifest = json.loads(args.manifest.read_text())
    expected_count = int(manifest.get("source_counts", {}).get("gaia_dr3_bulk", 0))
    if expected_count <= 0:
        raise SystemExit("Manifest has no positive gaia_dr3_bulk source count")

    samples = sample_container(args.container, args.sample_size, args.seed)
    if len(samples) != args.sample_size:
        raise SystemExit(f"Only found {len(samples)} unique fine-level source IDs")

    source_rows = read_source_rows(args.source, [sample["source_id"] for sample in samples])
    failures: list[dict] = []
    for sample in samples:
        source = source_rows.get(sample["source_id"])
        if source is None:
            failures.append({"source_id": sample["source_id"], "reason": "missing source row"})
            continue
        expected_x, expected_y, magnitude = source
        tolerance = sample["span_au"] / 65_535.0 + 1e-6
        expected_mag = encode_magnitude(magnitude)
        if (
            abs(sample["x_au"] - expected_x) > tolerance
            or abs(sample["y_au"] - expected_y) > tolerance
            or sample["encoded_magnitude"] != expected_mag
        ):
            failures.append({
                "source_id": sample["source_id"],
                "reason": "encoded values differ",
                "position_error_au": math.hypot(sample["x_au"] - expected_x, sample["y_au"] - expected_y),
                "position_tolerance_au": tolerance,
                "encoded_magnitude": sample["encoded_magnitude"],
                "expected_encoded_magnitude": expected_mag,
            })

    report = {
        "manifest_source_count": expected_count,
        "sample_size": len(samples),
        "matched_source_rows": len(source_rows),
        "failure_count": len(failures),
        "seed": args.seed,
        "failures": failures[:20],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 1 if failures else 0


def sample_container(path: Path, sample_size: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    with path.open("rb") as handle:
        header = handle.read(SMPK1_HEADER.size)
        _, _, entry_count = SMPK1_HEADER.unpack(header)
        index_bytes = header + handle.read(entry_count * 24)
        all_entries = read_container_index(index_bytes)
        source_id_levels = set(sorted({entry.key.span_log2 for entry in all_entries})[:2])
        entries = [entry for entry in all_entries if entry.key.span_log2 in source_id_levels]
        rng.shuffle(entries)
        samples: list[dict] = []
        seen_ids: set[int] = set()
        for entry in entries:
            handle.seek(entry.offset)
            tile_header = handle.read(SMP3_HEADER_BYTES)
            magic, _, flags, origin_x, origin_y, span, count = SMP3_HEADER.unpack(tile_header)
            if magic != SMP3_MAGIC or not flags & SMP3_FLAG_SOURCE_IDS or count == 0:
                continue
            attempts = min(count, max(1, math.ceil((sample_size - len(samples)) / max(1, len(entries) // 8))))
            for record_index in rng.sample(range(count), attempts):
                handle.seek(entry.offset + SMP3_HEADER_BYTES + record_index * SMP3_RECORD_BYTES)
                qx, qy, magnitude, _, _, _ = SMP3_RECORD.unpack(handle.read(SMP3_RECORD_BYTES))
                source_id_offset = entry.offset + SMP3_HEADER_BYTES + count * SMP3_RECORD_BYTES + record_index * 8
                handle.seek(source_id_offset)
                source_id = struct.unpack("<Q", handle.read(8))[0]
                if source_id in seen_ids:
                    continue
                seen_ids.add(source_id)
                samples.append({
                    "source_id": source_id,
                    "x_au": origin_x + qx / 65_535.0 * span,
                    "y_au": origin_y + qy / 65_535.0 * span,
                    "span_au": span,
                    "encoded_magnitude": magnitude,
                })
                if len(samples) == sample_size:
                    return samples
        return samples


def read_source_rows(source: str, source_ids: list[int]) -> dict[int, tuple[float, float, float | None]]:
    try:
        import duckdb
    except ImportError as error:
        raise SystemExit("Install scripts/gaia_bulk_requirements.txt before running the audit") from error
    escaped = source.replace("'", "''")
    values = ",".join(f"({source_id}::UBIGINT)" for source_id in source_ids)
    rows = duckdb.connect().execute(f"""
        WITH wanted(source_id) AS (VALUES {values})
        SELECT source_id::UBIGINT,
          (1000.0 / parallax) * {AU_PER_PC} * cos(radians(dec)) * cos(radians(ra)) AS x_au,
          (1000.0 / parallax) * {AU_PER_PC} *
            (cos(radians(23.43928)) * cos(radians(dec)) * sin(radians(ra))
             + sin(radians(23.43928)) * sin(radians(dec))) AS y_au,
          phot_g_mean_mag::DOUBLE
        FROM read_parquet('{escaped}', union_by_name=true, hive_partitioning=true)
        SEMI JOIN wanted USING (source_id)
    """).fetchall()
    return {int(source_id): (float(x_au), float(y_au), magnitude) for source_id, x_au, y_au, magnitude in rows}


def encode_magnitude(value: float | None) -> int:
    return 255 if value is None or not math.isfinite(value) else max(0, min(255, round((float(value) + 2) * 10)))


if __name__ == "__main__":
    raise SystemExit(main())
