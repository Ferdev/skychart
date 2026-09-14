#!/usr/bin/env python3
"""Sequentially measure the complete pinned Legacy DR10 south Tractor set.

Each provider file and all decoded table fields are verified before a durable
receipt is committed. Investigation-owned source/detail temporaries are then
recycled; source, candidate-detail and final serving bytes remain distinct.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request

from audit_fits_source import audit
from measure_fits_table_storage import measure as measure_tables
from measure_gaia_full_partitions import guard, save, sha


BASE = "https://portal.nersc.gov/cfs/cosmo/data/legacysurvey/dr10/south/tractor/"
FORMAT = "legacy-dr10-south-tractor-all-fields-zstd3-v1"
OWNER = "SkyChart isolated Legacy DR10 Tractor measurement 1271\n"
NAME = re.compile(r"tractor-[0-9]{4}[mp][0-9]{3}\.fits")


def manifest_entries(manifest_root):
    entries = []
    digest = hashlib.sha256()
    for path in sorted(manifest_root.glob("[0-9][0-9][0-9].sha256sum")):
        prefix = path.stem
        digest.update(prefix.encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) != 2 or len(parts[0]) != 64:
                raise ValueError("invalid Legacy checksum manifest line")
            filename = parts[1].lstrip("*")
            if not NAME.fullmatch(filename) or filename[8:11] != prefix:
                raise ValueError("unsafe or misplaced Legacy Tractor filename")
            entries.append({"prefix": prefix, "file": filename, "provider_sha256": parts[0]})
    if len({(row["prefix"], row["file"]) for row in entries}) != len(entries):
        raise ValueError("duplicate Legacy Tractor manifest entry")
    return entries, digest.hexdigest()


def download(url, output, root, floor):
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=180) as response, output.open("wb") as stream:
        while block := response.read(1 << 20):
            guard(root, floor)
            stream.write(block)
            digest.update(block)
        stream.flush()
        os.fsync(stream.fileno())
    return digest.hexdigest()


def table_shapes(audited):
    result = []
    for index, hdu in enumerate(audited["hdus"]):
        if "rows_read" not in hdu:
            continue
        names = list(hdu["field_statistics"])
        result.append({
            "hdu": index,
            "rows": hdu["rows_read"],
            "columns": hdu["fields"],
            "fields_sha256": hashlib.sha256("\n".join(names).encode()).hexdigest(),
            "header_sha256": hashlib.sha256(hdu["header"].encode()).hexdigest(),
        })
    return result


def clean_workspace(root):
    (root / "source.tmp.fits").unlink(missing_ok=True)
    (root / "audit.tmp.json").unlink(missing_ok=True)
    detail = root / "detail.tmp"
    if detail.exists():
        if (detail / "OWNER").read_text() != "SkyChart isolated FITS table storage 1271\n":
            raise ValueError("refusing to recycle unowned Legacy detail workspace")
        shutil.rmtree(detail)


def measure(root, manifest_root, base_url=BASE, expected_files=366_912,
            free_floor=60 << 30, max_files=0):
    if expected_files < 1 or free_floor < 0 or max_files < 0:
        raise ValueError("invalid Legacy measurement limit")
    entries, manifest_sha = manifest_entries(manifest_root)
    if len(entries) != expected_files:
        raise ValueError(f"Legacy manifest count differs: {len(entries)} != {expected_files}")
    root.mkdir(parents=True, exist_ok=True)
    lock = (root / ".lock").open("w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    owner = root / "OWNER"
    if owner.exists():
        if owner.read_text() != OWNER:
            raise ValueError("unowned Legacy output")
    else:
        if any(path.name != ".lock" for path in root.iterdir()):
            raise ValueError("nonempty unowned Legacy output")
        owner.write_text(OWNER)
    pin = {
        "format": FORMAT,
        "manifest_set_sha256": manifest_sha,
        "files": expected_files,
        "base_url": base_url,
        "scope": "DR10 south Tractor FITS files; corrected sweep families remain separate",
    }
    manifest = root / "manifest.json"
    if manifest.exists() and json.loads(manifest.read_text()) != pin:
        raise ValueError("Legacy release or measurement contract changed")
    save(manifest, pin)
    receipts = root / "receipts"
    receipts.mkdir(exist_ok=True)
    clean_workspace(root)
    added = 0
    started = time.monotonic()
    for ordinal, item in enumerate(entries):
        receipt_path = receipts / f"{ordinal:06d}.json"
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            expected = (ordinal, item["prefix"], item["file"], item["provider_sha256"])
            actual = tuple(receipt[k] for k in ("ordinal", "prefix", "file", "provider_sha256"))
            if actual != expected or not receipt.get("all_fields_verified"):
                raise ValueError("Legacy checkpoint contract changed")
            continue
        if max_files and added >= max_files:
            break
        guard(root, free_floor)
        tick = time.monotonic()
        source = root / "source.tmp.fits"
        audit_path = root / "audit.tmp.json"
        detail = root / "detail.tmp"
        url = base_url.rstrip("/") + "/" + item["prefix"] + "/" + item["file"]
        save(root / "progress.json", {
            "status": "ACQUIRING", "ordinal": ordinal, "file": item["file"],
            "committed_files": ordinal, "expected_files": expected_files,
        })
        actual_sha = download(url, source, root, free_floor)
        if actual_sha != item["provider_sha256"]:
            raise ValueError("Legacy provider checksum mismatch")
        save(root / "progress.json", {
            "status": "AUDITING_AND_MEASURING_ALL_FIELDS", "ordinal": ordinal,
            "file": item["file"], "committed_files": ordinal,
            "expected_files": expected_files,
        })
        audited = audit(source, actual_sha, batch_rows=1024)
        save(audit_path, audited)
        stored = measure_tables(source, audit_path, detail, batch_rows=1024,
                                free_floor=free_floor)
        shapes = table_shapes(audited)
        if stored["detail_bytes"] != sum(row["bytes"] for row in stored["tables"]):
            raise ValueError("Legacy detail byte accounting mismatch")
        receipt = {
            "format": FORMAT,
            "ordinal": ordinal,
            **item,
            "url": url,
            "source_bytes": source.stat().st_size,
            "source_allocated_bytes": source.stat().st_blocks * 512,
            "detail_bytes": stored["detail_bytes"],
            "detail_allocated_bytes": stored["detail_allocated_bytes"],
            "detail_sha256": [row["sha256"] for row in stored["tables"]],
            "table_shapes": shapes,
            "rows": sum(row["rows"] for row in shapes),
            "columns_by_table": [row["columns"] for row in shapes],
            "all_fields_verified": True,
            "seconds": time.monotonic() - tick,
            "full_serving_bytes": None,
        }
        save(receipt_path, receipt)
        clean_workspace(root)
        added += 1
        print(json.dumps(receipt), flush=True)

    accepted = [json.loads(path.read_text()) for path in sorted(receipts.glob("*.json"))]
    complete = len(accepted) == expected_files
    result = {
        "status": "FULL_TRACTOR_SOURCE_AND_CANDIDATE_DETAIL_MEASURED" if complete else "INCOMPLETE",
        "files": len(accepted),
        "expected_files": expected_files,
        "rows": sum(row["rows"] for row in accepted),
        "source_bytes": sum(row["source_bytes"] for row in accepted),
        "candidate_detail_bytes": sum(row["detail_bytes"] for row in accepted),
        "seconds_current_invocation": time.monotonic() - started,
        "full_serving_bytes": None,
        "remaining": [
            "corrected standard/extra/light-curve/photo-z sweeps",
            "global exact and angular indexes",
            "cross-identification and native rendering/API budgets",
        ],
    }
    save(root / ("measurement.json" if complete else "progress.json"), result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("manifest_root", type=Path)
    parser.add_argument("--base-url", default=BASE)
    parser.add_argument("--expected-files", type=int, default=366_912)
    parser.add_argument("--free-floor-gib", type=int, default=60)
    parser.add_argument("--max-files", type=int, default=0)
    args = parser.parse_args()
    print(json.dumps(measure(args.root, args.manifest_root, args.base_url,
                             args.expected_files, args.free_floor_gib << 30,
                             args.max_files)))
