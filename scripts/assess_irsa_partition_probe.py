#!/usr/bin/env python3
"""Turn one complete partition receipt into a bounded full-run feasibility report."""
import argparse
import json
import math
from pathlib import Path
import shutil
import time

from measure_gaia_full_partitions import save


def assess(probe, inventory, *, free_bytes, free_floor_bytes, memory_limit_bytes):
    workspace = probe["source_bytes"] + probe["detail_bytes"] + probe["build_projection"]["bytes"]
    required_headroom = math.ceil(workspace * 1.25)
    headroom = free_bytes - free_floor_bytes
    download_seconds = max(0.0, probe["wall_seconds_including_download"] - probe["seconds"])
    uncompressed_claims = {inventory["provider_reported_uncompressed_bytes"]}
    alternate = inventory.get("readme_provider_reported_uncompressed_bytes")
    if alternate is not None:
        uncompressed_claims.add(alternate)
    download_projection = download_seconds * inventory["provider_manifest_compressed_bytes"] / probe["source_bytes"]
    conversion_projections = [
        probe["seconds"] * value / probe["uncompressed_bytes"] for value in sorted(uncompressed_claims)
    ]
    linear_seconds = [download_projection + value for value in conversion_projections]
    safe = (headroom >= required_headroom and probe["peak_rss_kib"] * 1024 < memory_limit_bytes and
            probe["all_fields_verified"] and probe["full_bzip_crc_verified"])
    return {
        "status": "SAFE_TO_CONTINUE_SEQUENTIAL_MEASUREMENT" if safe else "INSUFFICIENT_HEADROOM_FOR_FULL_RUN",
        "observed_unix": time.time(),
        "measured_facts": {
            "probe_source_file": probe["source_file"],
            "probe_rows": probe["rows"],
            "probe_source_bytes": probe["source_bytes"],
            "probe_uncompressed_bytes": probe["uncompressed_bytes"],
            "probe_candidate_detail_bytes": probe["detail_bytes"],
            "probe_candidate_projection_bytes": probe["build_projection"]["bytes"],
            "probe_peak_coexisting_workspace_bytes": workspace,
            "probe_peak_rss_bytes": probe["peak_rss_kib"] * 1024,
            "probe_measurement_seconds": probe["seconds"],
            "probe_wall_seconds_including_download": probe["wall_seconds_including_download"],
            "provider_manifest_parts": inventory["parts"],
            "provider_manifest_compressed_bytes": inventory["provider_manifest_compressed_bytes"],
            "free_bytes_at_assessment": free_bytes,
            "free_floor_bytes": free_floor_bytes,
            "headroom_above_floor_bytes": headroom,
            "required_headroom_from_probe_bytes": required_headroom,
            "memory_limit_bytes": memory_limit_bytes,
        },
        "single_partition_linear_projection": {
            "method": "probe download seconds scaled by compressed bytes plus verified conversion seconds scaled by provider uncompressed-byte claim",
            "hours_by_provider_uncompressed_claim": [value / 3600 for value in linear_seconds],
            "sensitivity_hours_0_75x_to_1_5x": [min(linear_seconds) * 0.75 / 3600, max(linear_seconds) * 1.5 / 3600],
            "is_measured_full_duration": False,
        },
        "unknowns": [
            "network and provider throughput across later parts",
            "population-wide compression and conversion-time variance",
            "global exact/angular/cross-identification/rendering artifact sizes",
            "admitted native serving format and rollback storage",
        ],
        "policy": "Sequential parts recycle only probe-owned source/detail/projection files after durable checksummed receipts.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--free-floor-gib", type=int, default=60)
    parser.add_argument("--memory-limit-mib", type=int, required=True)
    args = parser.parse_args()
    receipts = sorted((args.root / "receipts").glob("*.json"))
    if len(receipts) != 1:
        raise ValueError("exactly one completed probe receipt is required")
    probe = json.loads(receipts[0].read_text())
    inventory = json.loads(args.inventory.read_text())
    result = assess(
        probe, inventory, free_bytes=shutil.disk_usage(args.root).free,
        free_floor_bytes=args.free_floor_gib << 30,
        memory_limit_bytes=args.memory_limit_mib << 20,
    )
    save(args.root / "feasibility.json", result)
    print(json.dumps(result, sort_keys=True))
    if result["status"] != "SAFE_TO_CONTINUE_SEQUENTIAL_MEASUREMENT":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
