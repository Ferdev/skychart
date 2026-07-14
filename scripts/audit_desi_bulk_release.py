#!/usr/bin/env python3
"""Audit a catalog SMP3 layer against its projected source table."""

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
    SMPK1_ENTRY,
    SMPK1_HEADER,
    SMPK1_MAGIC,
    read_container_index,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--layer-id", default="desi_dr1")
    parser.add_argument("--sample-size", type=int, default=1_000)
    parser.add_argument("--seed", type=int, default=2_026_071_3)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    layer = next((item for item in manifest.get("layers", []) if item.get("id") == args.layer_id), None)
    if layer is None:
        raise SystemExit(f"Manifest has no {args.layer_id} layer")
    expected_count = sum(int(value) for value in layer.get("source_counts", {}).values())
    if expected_count <= 0:
        raise SystemExit(f"{args.layer_id} source count is not positive")

    structure = audit_structure(args.container, layer)
    samples = sample_container(args.container, args.sample_size, args.seed)
    if len(samples) != args.sample_size:
        raise SystemExit(f"Only found {len(samples)} unique {args.layer_id} source IDs")
    source_rows = read_source_rows(args.source, [sample["target_id"] for sample in samples])
    failures = []
    for sample in samples:
        source = source_rows.get(sample["target_id"])
        if source is None:
            failures.append({"target_id": sample["target_id"], "reason": "missing source row"})
            continue
        expected_x, expected_y, magnitude, type_code, color_idx = source
        tolerance = sample["span_au"] / 65_535.0 + 1e-6
        if (
            abs(sample["x_au"] - expected_x) > tolerance
            or abs(sample["y_au"] - expected_y) > tolerance
            or sample["magnitude"] != encode_magnitude(magnitude)
            or sample["type_code"] != type_code
            or sample["color_idx"] != color_idx
        ):
            failures.append({
                "target_id": sample["target_id"],
                "reason": "encoded values differ",
                "position_error_au": math.hypot(sample["x_au"] - expected_x, sample["y_au"] - expected_y),
                "position_tolerance_au": tolerance,
            })

    report = {
        "manifest_source_count": expected_count,
        "structure": structure,
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


def audit_structure(path: Path, layer: dict) -> dict:
    size = path.stat().st_size
    with path.open("rb") as handle:
        header = handle.read(SMPK1_HEADER.size)
        magic, version, count = SMPK1_HEADER.unpack(header)
        if magic != SMPK1_MAGIC or version != 1:
            raise SystemExit("Invalid SMPK1 header")
        entries = read_container_index(header + handle.read(count * SMPK1_ENTRY.size))
    if len(entries) != count:
        raise SystemExit("Container index count does not match header")
    expected_tiles = sum(int(level["tile_count"]) for level in layer.get("levels", []))
    if count != expected_tiles:
        raise SystemExit(f"Container has {count} index entries; manifest declares {expected_tiles}")
    previous_end = SMPK1_HEADER.size + count * SMPK1_ENTRY.size
    for entry in entries:
        if entry.offset < previous_end or entry.length < SMP3_HEADER_BYTES or entry.offset + entry.length > size:
            raise SystemExit("Container index contains an invalid or overlapping range")
        previous_end = entry.offset + entry.length
    if previous_end != size:
        raise SystemExit("Container has unindexed trailing bytes")
    return {"container_bytes": size, "tile_count": count, "last_indexed_byte": previous_end}


def sample_container(path: Path, sample_size: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    with path.open("rb") as handle:
        header = handle.read(SMPK1_HEADER.size)
        _, _, entry_count = SMPK1_HEADER.unpack(header)
        entries = read_container_index(header + handle.read(entry_count * SMPK1_ENTRY.size))
        rng.shuffle(entries)
        samples = []
        seen_ids = set()
        for entry in entries:
            handle.seek(entry.offset)
            tile_header = handle.read(SMP3_HEADER_BYTES)
            magic, _, flags, origin_x, origin_y, span, count = SMP3_HEADER.unpack(tile_header)
            if magic != SMP3_MAGIC or not flags & SMP3_FLAG_SOURCE_IDS or count == 0:
                continue
            attempts = min(count, max(1, math.ceil((sample_size - len(samples)) / max(1, len(entries) // 8))))
            for index in rng.sample(range(count), attempts):
                handle.seek(entry.offset + SMP3_HEADER_BYTES + index * SMP3_RECORD_BYTES)
                qx, qy, magnitude, color_idx, type_code, _ = SMP3_RECORD.unpack(handle.read(SMP3_RECORD_BYTES))
                handle.seek(entry.offset + SMP3_HEADER_BYTES + count * SMP3_RECORD_BYTES + index * 8)
                target_id = struct.unpack("<Q", handle.read(8))[0]
                if target_id in seen_ids:
                    continue
                seen_ids.add(target_id)
                samples.append({
                    "target_id": target_id,
                    "x_au": origin_x + qx / 65_535.0 * span,
                    "y_au": origin_y + qy / 65_535.0 * span,
                    "span_au": span,
                    "magnitude": magnitude,
                    "type_code": type_code,
                    "color_idx": color_idx,
                })
                if len(samples) == sample_size:
                    return samples
        return samples


def read_source_rows(source: Path, target_ids: list[int]) -> dict[int, tuple]:
    try:
        import duckdb
    except ImportError as error:
        raise SystemExit("Install scripts/desi_bulk_requirements.txt before running the audit") from error
    values = ",".join(f"({target_id}::UBIGINT)" for target_id in target_ids)
    rows = duckdb.connect().execute(f"""
        WITH wanted(target_id) AS (VALUES {values})
        SELECT target_id::UBIGINT, x_au::DOUBLE, y_au::DOUBLE,
          magnitude::DOUBLE, type_code::UTINYINT, color_idx::UTINYINT
        FROM read_parquet('{str(source).replace("'", "''")}')
        SEMI JOIN wanted USING (target_id)
    """).fetchall()
    return {int(row[0]): tuple(row[1:]) for row in rows}


def encode_magnitude(value: float | None) -> int:
    return 255 if value is None or not math.isfinite(value) else max(0, min(255, round((float(value) + 2) * 10)))


if __name__ == "__main__":
    raise SystemExit(main())
