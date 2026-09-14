#!/usr/bin/env python3
"""Stage pinned public source files into a resumable, auditable owned release.

This is bounded local staging, not permission to run a production bulk import.
Source schemas and original files are retained once per release. SQLite is a
temporary staging index, not the chosen billion-row serving layout (C06 gate).
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalog_source_adapter import rows, parse_row
from backend.catalog_astrometry import CONTRACT, FRAME, ROTATION, physical_parallax_distance

NORMALIZER_VERSION = "catalog-staging-v1"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def manifest_id(manifest):
    # File enumeration order is not scientifically meaningful.
    manifest = dict(manifest, normalizer_version=NORMALIZER_VERSION, files=sorted(manifest["files"], key=lambda p: p["name"]))
    return hashlib.sha256(canonical(manifest).encode()).hexdigest()


def validate_manifest(manifest):
    if manifest.get("schema_version") != 1:
        raise ValueError("unsupported manifest schema")
    if manifest.get("normalizer_version", NORMALIZER_VERSION) != NORMALIZER_VERSION:
        raise ValueError("unsupported normalizer version; retain the old release unchanged")
    for key in ("provider", "catalog", "release", "documentation"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise ValueError("pinned namespace and documentation required")
    fields = manifest["fields"]
    names = [f["name"] for f in fields]
    if not fields or len(names) != len(set(names)):
        raise ValueError("duplicate or missing schema fields")
    if any(f.get("type") not in {"text", "id", "integer", "float"} or "unit" not in f for f in fields):
        raise ValueError("each field requires an explicit type and unit (null for identifiers)")
    if manifest["mapping"]["id"] not in names:
        raise ValueError("source ID column required")
    permitted = {"id", "name", "ra", "dec", "epoch", "parallax", "parallax_error"}
    if not set(manifest["mapping"]) <= permitted:
        raise ValueError("unknown normalization mapping")
    if any(value not in names for value in manifest["mapping"].values()):
        raise ValueError("mapping refers to an unknown field")
    by_name = {f["name"]: f for f in fields}
    for key, unit in {"ra":"deg", "dec":"deg", "epoch":"yr", "parallax":"mas", "parallax_error":"mas"}.items():
        if key in manifest["mapping"]:
            field = by_name[manifest["mapping"][key]]
            if field["type"] != "float" or field["unit"] != unit:
                raise ValueError("normalize numeric measurements and units explicitly: " + key)
    if by_name[manifest["mapping"]["id"]]["type"] not in {"id", "text", "integer"}:
        raise ValueError("source IDs must not pass through floating point")
    if "name" in manifest["mapping"] and by_name[manifest["mapping"]["name"]]["type"] not in {"id", "text"}:
        raise ValueError("names must be text")
    files = manifest["files"]
    if not files or len({f["name"] for f in files}) != len(files):
        raise ValueError("unique source files required")
    for part in files:
        if Path(part["name"]).name != part["name"] or part["name"] in {"", ".", ".."}:
            raise ValueError("source filename must be a basename")
        if part["format"] not in {"csv", "ecsv", "delimited", "cds_fixed", "fits", "votable"}:
            raise ValueError("unsupported source format")
        if part.get("compression") not in {None, "gzip"}:
            raise ValueError("unsupported compression")
        if len(part["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in part["sha256"]):
            raise ValueError("pinned source SHA-256 required")
        if type(part["rows"]) is not int or part["rows"] < 0:
            raise ValueError("upstream file row count required")
    if type(manifest["expected_rows"]) is not int or sum(f["rows"] for f in files) != manifest["expected_rows"]:
        raise ValueError("upstream file counts do not reconcile")


@contextmanager
def exclusive(path):
    with path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".part")
    with temporary.open("w") as stream:
        stream.write(canonical(value) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def normalize(values, manifest):
    mapping = manifest["mapping"]
    def value(key):
        return values.get(mapping.get(key))
    source_id = value("id")
    if not isinstance(source_id, str) or not source_id.strip():
        raise ValueError("missing_or_nontext_source_id")
    ra, dec = value("ra"), value("dec")
    if ra is not None and (not isinstance(ra, (int, float)) or not 0 <= ra < 360):
        raise ValueError("ra_out_of_range")
    if dec is not None and (not isinstance(dec, (int, float)) or not -90 <= dec <= 90):
        raise ValueError("dec_out_of_range")
    astrometry = {"ra_deg": ra, "dec_deg": dec, "frame": manifest.get("angular_frame"),
                  "source_epoch": value("epoch") if "epoch" in mapping else manifest.get("source_epoch")}
    angular = ra is not None and dec is not None
    if angular and astrometry["frame"] != "ICRS":
        raise ValueError("unsupported_angular_frame")
    estimate = physical_parallax_distance(value("parallax"), value("parallax_error"),
                                         manifest.get("minimum_parallax_snr", 5))
    spatial = None
    if angular and estimate:
        radius = estimate["distance_pc"] * CONTRACT["parsec_au"]
        r, d = math.radians(ra), math.radians(dec)
        equatorial = (radius * math.cos(d) * math.cos(r), radius * math.cos(d) * math.sin(r), radius * math.sin(d))
        xyz = [sum(a*b for a,b in zip(row, equatorial)) for row in ROTATION]
        spatial = dict(zip(("x_au", "y_au", "z_au"), xyz))
        spatial.update(frame=FRAME, distance_model="parallax_estimate", evidence=estimate)
    # Namespace, units and schema are stored once in the pinned manifest. Values
    # are retained once here, without a second redundant raw JSON row payload.
    return {"source_id": source_id, "name": value("name") or source_id,
            "astrometry": astrometry, "spatial": spatial, "distance": estimate, "values": values,
            "capabilities": {"searchable_metadata": True, "angular_position": angular,
                             "spatial_position": spatial is not None, "dynamic_ephemeris": False}}


def open_stage(path):
    db = sqlite3.connect(path)
    db.execute("PRAGMA cache_size=-8192")
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA synchronous=FULL")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS records (source_id TEXT PRIMARY KEY, payload TEXT NOT NULL, sha256 TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS record_origins (source_id TEXT PRIMARY KEY, file TEXT NOT NULL, row_number INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints (file TEXT PRIMARY KEY, rows INTEGER NOT NULL, complete INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS quarantine (file TEXT, row_number INTEGER, reason TEXT NOT NULL, PRIMARY KEY(file,row_number));
    """)
    return db


def stage(manifest, source_root, stage_root, *, max_records=100_000, batch_size=500, max_source_bytes=1024**3):
    validate_manifest(manifest)
    if max_records <= 0 or not 1 <= batch_size <= 10_000:
        raise ValueError("positive record budget and bounded batch size required")
    stage_root.mkdir(parents=True, exist_ok=True)
    if max_source_bytes <= 0:
        raise ValueError("positive source byte budget required")
    release = stage_root / manifest_id(manifest)
    release.mkdir(exist_ok=True)
    with exclusive(release / ".lock"):
        source_bytes = 0
        missing_bytes = 0
        for part in manifest["files"]:
            owned = release / "inputs" / part["name"]
            size = (owned if owned.exists() else source_root / part["name"]).stat().st_size
            source_bytes += size
            if not owned.exists():
                missing_bytes += size
        if source_bytes > max_source_bytes:
            raise ValueError("source bytes exceed explicit staging budget")
        if missing_bytes > shutil.disk_usage(stage_root).free:
            raise ValueError("insufficient staging disk; previous releases retained")
        manifest_path = release / "manifest.json"
        if manifest_path.exists() and manifest_id(json.loads(manifest_path.read_text())) != manifest_id(manifest):
            raise ValueError("manifest changed")
        write_json(manifest_path, dict(manifest, normalizer_version=NORMALIZER_VERSION, files=sorted(manifest["files"], key=lambda p:p["name"])))
        if (release / "seal.json").exists():
            return verify(release)
        inputs = release / "inputs"
        inputs.mkdir(exist_ok=True)
        db = open_stage(release / "records.sqlite")
        consumed = 0
        try:
            for part in sorted(manifest["files"], key=lambda p:p["name"]):
                owned = inputs / part["name"]
                if not owned.exists():
                    source = source_root / part["name"]
                    if digest(source) != part["sha256"]:
                        raise ValueError("source checksum mismatch: " + part["name"])
                    temporary = owned.with_suffix(owned.suffix + ".part")
                    shutil.copyfile(source, temporary)
                    if digest(temporary) != part["sha256"]:
                        raise ValueError("source changed during staging")
                    with temporary.open("rb") as stream:
                        os.fsync(stream.fileno())
                    os.replace(temporary, owned)
                    directory = os.open(inputs, os.O_DIRECTORY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
                if digest(owned) != part["sha256"]:
                    raise ValueError("owned source checksum mismatch")
                checkpoint = db.execute("SELECT rows, complete FROM checkpoints WHERE file=?", (part["name"],)).fetchone()
                if checkpoint and checkpoint[1]:
                    continue
                previous = checkpoint[0] if checkpoint else 0
                row_number = 0
                for row_number, raw in enumerate(rows(owned, part, manifest["fields"]), 1):
                    if row_number <= previous:
                        continue
                    if consumed >= max_records:
                        db.commit()
                        return report(db, manifest, "paused")
                    try:
                        values = parse_row(raw, manifest["fields"], manifest.get("nulls", ["", "\\N"]))
                        normalized = normalize(values, manifest)
                        payload = canonical(normalized)
                        db.execute("INSERT INTO records VALUES (?,?,?)", (normalized["source_id"], payload, hashlib.sha256(payload.encode()).hexdigest()))
                        db.execute("INSERT INTO record_origins VALUES (?,?,?)", (normalized["source_id"], part["name"], row_number))
                    except (ValueError, sqlite3.IntegrityError) as error:
                        reason = "duplicate_source_id" if isinstance(error, sqlite3.IntegrityError) else str(error)[:200]
                        db.execute("INSERT INTO quarantine VALUES (?,?,?)", (part["name"], row_number, reason))
                    db.execute("INSERT OR REPLACE INTO checkpoints VALUES (?,?,0)", (part["name"], row_number))
                    consumed += 1
                    if consumed % batch_size == 0:
                        db.commit()
                if row_number != part["rows"]:
                    raise ValueError("source file row count mismatch: " + part["name"])
                db.execute("INSERT OR REPLACE INTO checkpoints VALUES (?,?,1)", (part["name"], row_number))
                db.commit()
            result = report(db, manifest, "complete")
            if result["fetched"] != manifest["expected_rows"] or result["fetched"] != result["accepted"] + result["quarantined"]:
                raise ValueError("release accounting mismatch")
        finally:
            db.close()  # Rolls back any interrupted, uncommitted batch.
        write_json(release / "seal.json", {"manifest_id": manifest_id(manifest),
                   "database_sha256": digest(release / "records.sqlite"), "report": result})
        return result


def report(db, manifest, state):
    accepted = db.execute("SELECT count(*) FROM records").fetchone()[0]
    quarantined = db.execute("SELECT count(*) FROM quarantine").fetchone()[0]
    fetched = db.execute("SELECT coalesce(sum(rows),0) FROM checkpoints").fetchone()[0]
    known = db.execute("SELECT count(*) FROM records WHERE json_extract(payload,'$.distance') IS NOT NULL").fetchone()[0]
    return {"state":state, "release_id":manifest_id(manifest), "expected_rows":manifest["expected_rows"],
            "fetched":fetched, "accepted":accepted, "quarantined":quarantined,
            "known_distance":known, "unknown_distance":accepted-known,
            "established_identities":0, "coverage":"unadmitted", "rendered_lod":None}


def verify(release):
    manifest = json.loads((release / "manifest.json").read_text())
    validate_manifest(manifest)
    seal = json.loads((release / "seal.json").read_text())
    if seal["manifest_id"] != manifest_id(manifest) or digest(release / "records.sqlite") != seal["database_sha256"]:
        raise ValueError("release seal mismatch")
    for part in manifest["files"]:
        if digest(release / "inputs" / part["name"]) != part["sha256"]:
            raise ValueError("owned source changed")
    with sqlite3.connect((release / "records.sqlite").resolve().as_uri() + "?mode=ro", uri=True) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("staging index corrupt")
        result = report(db, manifest, "complete")
        completed = db.execute("SELECT count(*) FROM checkpoints WHERE complete=1").fetchone()[0]
        if (result != seal["report"] or result["fetched"] != manifest["expected_rows"]
                or result["fetched"] != result["accepted"] + result["quarantined"]
                or completed != len(manifest["files"])):
            raise ValueError("release report changed")
    return result


def activate(release, owned_root):
    """Atomic local staging pointer; never deploys, alters Postgres or admits coverage."""
    result = verify(release)
    manifest = json.loads((release / "manifest.json").read_text())
    owned_root.mkdir(parents=True, exist_ok=True)
    # Retained release directories must be under this owned root; no external paths.
    relative = release.resolve().relative_to(owned_root.resolve())
    with exclusive(owned_root / ".active.lock"):
        path = owned_root / "active-staging.json"
        current = json.loads(path.read_text()) if path.exists() else {}
        key = canonical([manifest["provider"], manifest["catalog"]])
        current[key] = {"release_id":result["release_id"], "path":str(relative)}
        write_json(path, current)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("stage", "verify", "activate", "estimate"))
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--source-root", type=Path, default=Path("data/catalog-downloads"))
    parser.add_argument("--stage-root", type=Path, default=Path("data/catalog-staging"))
    parser.add_argument("--release", type=Path)
    parser.add_argument("--max-records", type=int, default=100_000)
    parser.add_argument("--max-source-bytes", type=int, default=1024**3)
    args = parser.parse_args()
    if args.command in {"stage", "estimate"}:
        if not args.manifest:
            parser.error("--manifest required")
        manifest = json.loads(args.manifest.read_text())
        validate_manifest(manifest)
        result = stage(manifest, args.source_root, args.stage_root, max_records=args.max_records, max_source_bytes=args.max_source_bytes) if args.command == "stage" else {
            "expected_rows":manifest["expected_rows"], "source_bytes":sum((args.source_root/p["name"]).stat().st_size for p in manifest["files"]),
            "record_budget":args.max_records, "serving_storage_bytes":None, "capacity_approved":False}
    else:
        if not args.release:
            parser.error("--release required")
        result = verify(args.release) if args.command == "verify" else activate(args.release, args.stage_root)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
