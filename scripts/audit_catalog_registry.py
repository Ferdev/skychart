#!/usr/bin/env python3
"""Audit local catalog evidence. Never download, import, or infer completeness.

Use --database to opt into bounded read-only counts using libpq environment
variables. Counts describe that connection only, never an assumed production DB.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FIELDS = {
    "id", "provider", "catalog", "release", "product_kind", "population",
    "documentation", "identifiers", "upstream_rows", "columns_documentation",
    "coordinate_frame", "source_epoch", "distance_fields", "quality_fields",
    "selection", "download", "attribution", "refresh", "estimated_bytes",
    "coverage", "reason", "rollout_order", "local_snapshots", "verification",
}


def validate_registry(registry):
    if registry.get("schema_version") != 1:
        raise ValueError("unsupported registry schema")
    ids, orders = set(), set()
    for entry in registry["catalogs"]:
        missing = REQUIRED_FIELDS - entry.keys()
        if missing:
            raise ValueError(f"missing registry fields: {sorted(missing)}")
        if entry["id"] in ids or entry["rollout_order"] in orders:
            raise ValueError("duplicate catalog ID or rollout order")
        ids.add(entry["id"])
        orders.add(entry["rollout_order"])
        if entry["coverage"] not in {"deferred", "partial", "complete"}:
            raise ValueError("invalid coverage status")
        if entry["product_kind"] not in {
            "source_catalog", "object_database", "observation_table",
            "crossmatch_table", "detection_table", "images",
        }:
            raise ValueError("invalid product kind")
        count = entry["upstream_rows"]
        if count is not None and (type(count) is not int or count < 0):
            raise ValueError("upstream row count must be a nonnegative integer or null")
        if not entry["documentation"] or not entry["reason"]:
            raise ValueError("documentation and inclusion/deferment reason required")
        if any(Path(name).name != name for name in entry["local_snapshots"]):
            raise ValueError("snapshot paths must be catalog basenames")
        if entry["coverage"] == "complete":
            validate_admission(entry)
    targets = set(registry["first_release_set"]) | {registry["first_manageable_fallback"]}
    if not targets <= ids:
        raise ValueError("release target missing from registry")
    completed = {entry["id"] for entry in registry["catalogs"] if entry["coverage"] == "complete"}
    if set(registry["admitted_releases"]) != completed:
        raise ValueError("admitted release list differs from complete entries")


def validate_admission(entry):
    evidence = entry.get("admission", {})
    counts = [evidence.get(key) for key in ("fetched", "accepted", "quarantined")]
    if any(type(n) is not int or n < 0 for n in counts):
        raise ValueError("complete release requires integer row accounting")
    fetched, accepted, quarantined = counts
    if fetched != entry["upstream_rows"] or fetched != accepted + quarantined:
        raise ValueError("complete release does not reconcile")
    if entry["selection"] is not None:
        raise ValueError("selected subset cannot be a complete release")
    if not entry["release"] or entry["attribution"]["status"] != "verified":
        raise ValueError("complete release requires pinned version and verified reuse")
    for key in ("manifest_sha256", "schema_sha256"):
        value = evidence.get(key, "")
        if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError(f"complete release requires {key}")
    for key in ("owned_artifact", "capacity_approval", "verification_report"):
        if not evidence.get(key):
            raise ValueError(f"complete release requires {key}")


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot_evidence(path, max_bytes):
    if not path.is_file():
        return {"file": path.name, "status": "absent", "records": None}
    size = path.stat().st_size
    result = {"file": path.name, "bytes": size, "records": None}
    if size > max_bytes:
        return result | {"status": "not_read", "reason": "exceeds bounded JSON audit size"}
    result["sha256"] = sha256(path)
    try:
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            raise ValueError("snapshot must be an object")
        collections = {k: v for k, v in data.items()
                       if k in {"stars", "objects", "systems"} and isinstance(v, list)}
        if len(collections) != 1:
            raise ValueError("expected exactly one source record collection")
        name, rows = next(iter(collections.items()))
        if any(not isinstance(row, dict) for row in rows):
            raise ValueError("snapshot entries must be objects")
        result.update(status="observed", records=len(rows), collection=name,
                      generated_at=data.get("generated_at_utc"),
                      source=data.get("source", data.get("sources")),
                      selection=data.get("selection"),
                      missing_distance=sum(row.get("distance_pc") is None and
                                           row.get("distance_ly") is None for row in rows),
                      missing_angular_position=sum(row.get("ra_deg") is None or
                                                   row.get("dec_deg") is None for row in rows))
    except (ValueError, UnicodeError) as error:
        result.update(status="invalid", reason=str(error))
    return result


def database_evidence():
    # Fixed SQL and read-only session; no CLI URLs or credentials in the report.
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=1000"
    env["PGCONNECT_TIMEOUT"] = "5"
    def query(sql):
        result = subprocess.run(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                                env=env, capture_output=True, text=True, timeout=20)
        if result.returncode:
            raise RuntimeError("database query failed (connection, permission, schema or timeout); credentials omitted")
        return json.loads(result.stdout)
    try:
        relations = query("SELECT json_build_object('source_union', to_regclass('public.catalog_source_objects') IS NOT NULL, 'legacy', to_regclass('public.catalog_objects') IS NOT NULL)")
        relation = "catalog_source_objects" if relations["source_union"] else "catalog_objects" if relations["legacy"] else None
        if relation is None:
            return {"status": "schema_unavailable", "counts": None}
        counts = query("SELECT coalesce(json_agg(t), '[]'::json) FROM (SELECT source_type, catalog_group, count(*) AS rows FROM " + relation + " GROUP BY source_type, catalog_group ORDER BY source_type, catalog_group) t")
        return {"status": "observed", "scope": "explicit libpq connection; not production attestation",
                "relation": relation, "counts": counts, "release_reconciliation": "unavailable"}
    except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError):
        return {"status": "unavailable", "counts": None,
                "reason": "bounded read-only query failed; do not interpret as zero rows"}


def audit(root, registry, max_bytes=128 * 1024 * 1024, database=False):
    validate_registry(registry)
    files = sorted({name for entry in registry["catalogs"] for name in entry["local_snapshots"]})
    return {
        "schema_version": 1, "registry_version": registry["registry_version"],
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "scope": "local evidence only; file counts are not imported database or unique object counts",
        "snapshots": [snapshot_evidence(root / "data/catalogs" / name, max_bytes) for name in files],
        "database": database_evidence() if database else {"status": "not_requested", "counts": None},
        "admitted_releases": registry["admitted_releases"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--registry", type=Path, default=ROOT / "data/catalog-registry/registry-v1.json")
    parser.add_argument("--database", action="store_true")
    parser.add_argument("--max-json-bytes", type=int, default=128 * 1024 * 1024)
    args = parser.parse_args()
    if args.max_json_bytes <= 0:
        parser.error("--max-json-bytes must be positive")
    registry = json.loads(args.registry.read_text())
    print(json.dumps(audit(args.root, registry, args.max_json_bytes, args.database), indent=2))


if __name__ == "__main__":
    main()
