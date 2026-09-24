#!/usr/bin/env python3
"""Pin an IRSA bulk table's provider manifests without claiming owned storage.

This inventories the complete provider-published file set, checks that the
download script, size list and MD5 list name the same data parts, and records
exact provider bytes.  It does not download the data parts or measure the
candidate/native SkyChart representation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


MD5_RE = re.compile(r"^([0-9a-fA-F]{32})\s+\*?([^\s]+)$")
URL_RE = re.compile(r"https?://[^\s'\"]+")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def fetch(url, limit=10_000_000):
    request = Request(url, headers={"User-Agent": "SkyChart storage investigation/1271"})
    with urlopen(request, timeout=60) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError(f"provider metadata exceeds {limit} bytes: {url}")
        final_url = response.geturl()
    return data, final_url


def parse_md5(data):
    rows = {}
    for line in data.decode("ascii").splitlines():
        if not line.strip():
            continue
        match = MD5_RE.fullmatch(line.strip())
        if not match:
            raise ValueError("invalid MD5 manifest line")
        checksum, name = match.groups()
        if Path(name).name != name or name in rows:
            raise ValueError("unsafe or duplicate MD5 filename")
        rows[name] = checksum.lower()
    return rows


def parse_sizes(data):
    rows = {}
    for line in data.decode("ascii").splitlines():
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) < 6 or not parts[4].isdigit():
            raise ValueError("invalid provider size line")
        name = parts[-1]
        if Path(name).name != name or name in rows:
            raise ValueError("unsafe or duplicate size filename")
        rows[name] = int(parts[4])
    return rows


def parse_wget_names(data):
    names = set()
    for url in URL_RE.findall(data.decode("utf-8")):
        name = Path(urlparse(url).path).name
        if name:
            names.add(name)
    return names


def parse_schema(data):
    fields = []
    for line in data.decode("utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            name = stripped.split()[0]
            if name in fields:
                raise ValueError("duplicate schema field")
            fields.append(name)
    if not fields:
        raise ValueError("empty provider schema")
    return fields


def build_receipt(blobs, *, base_url, catalog_id, provider_table, release,
                  record_kind, provider_rows, provider_uncompressed_bytes,
                  expected_parts, names, readme_provider_uncompressed_bytes=None):
    md5_rows = parse_md5(blobs["md5"])
    size_rows = parse_sizes(blobs["sizes"])
    wget_names = parse_wget_names(blobs["wget"])
    fields = parse_schema(blobs["schema"])
    part_names = set(md5_rows)
    if part_names != set(size_rows):
        raise ValueError("MD5 and size manifests name different data parts")
    if not part_names.issubset(wget_names):
        raise ValueError("download script omits provider-manifest data parts")
    if len(part_names) != expected_parts:
        raise ValueError("provider part count differs from pinned release")
    ordered = sorted(part_names)
    return {
        "status": "COMPLETE_PROVIDER_MANIFEST_INVENTORY",
        "evidence_class": "provider_published_metadata_not_downloaded_or_owned_storage",
        "observed_unix": time.time(),
        "catalog_id": catalog_id,
        "provider": "NASA/IPAC Infrared Science Archive (IRSA)",
        "provider_table": provider_table,
        "release": release,
        "record_kind": record_kind,
        "base_url": base_url,
        "provider_reported_rows": provider_rows,
        "provider_reported_uncompressed_bytes": provider_uncompressed_bytes,
        "readme_provider_reported_uncompressed_bytes": readme_provider_uncompressed_bytes,
        "provider_uncompressed_byte_claims_agree": (
            readme_provider_uncompressed_bytes is None or
            readme_provider_uncompressed_bytes == provider_uncompressed_bytes
        ),
        "parts": len(ordered),
        "provider_manifest_compressed_bytes": sum(size_rows.values()),
        "minimum_part_bytes": min(size_rows.values()),
        "maximum_part_bytes": max(size_rows.values()),
        "first_part": ordered[0],
        "last_part": ordered[-1],
        "checksums": {
            "algorithm": "MD5",
            "per_part_count": len(md5_rows),
            "manifest_sha256": sha256(blobs["md5"]),
        },
        "sizes_manifest_sha256": sha256(blobs["sizes"]),
        "download_script_sha256": sha256(blobs["wget"]),
        "readme_sha256": sha256(blobs["readme"]),
        "schema": {
            "columns": len(fields),
            "fields": fields,
            "sha256": sha256(blobs["schema"]),
        },
        "provider_metadata_files": {
            key: {"name": names[key], "bytes": len(blobs[key]), "sha256": sha256(blobs[key])}
            for key in ("wget", "md5", "sizes", "schema", "readme")
        },
        "source_bytes_measured": None,
        "owned_full_schema_bytes_measured": None,
        "serving_artifact_bytes_measured": None,
        "scope": (
            "Exact provider-published compressed-byte and part inventory only. "
            "Data parts were not downloaded by this command; final SkyChart data, indexes, "
            "routing, cross-identification, rendering and rollback storage remain unmeasured."
        ),
    }


def inventory(args):
    names = {key: getattr(args, key) for key in ("wget", "md5", "sizes", "schema", "readme")}
    blobs = {}
    final_urls = {}
    for key, name in names.items():
        data, final_url = fetch(urljoin(args.base_url, name))
        blobs[key] = data
        final_urls[key] = final_url
        atomic_write(args.output / name, data)
    receipt = build_receipt(
        blobs, base_url=args.base_url, catalog_id=args.catalog_id,
        provider_table=args.provider_table, release=args.release,
        record_kind=args.record_kind, provider_rows=args.provider_rows,
        provider_uncompressed_bytes=args.provider_uncompressed_bytes,
        expected_parts=args.expected_parts, names=names,
        readme_provider_uncompressed_bytes=args.readme_provider_uncompressed_bytes,
    )
    receipt["final_metadata_urls"] = final_urls
    encoded = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode()
    atomic_write(args.output / "inventory.receipt.json", encoded)
    print(json.dumps(receipt, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--catalog-id", required=True)
    parser.add_argument("--provider-table", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--record-kind", required=True)
    parser.add_argument("--provider-rows", type=int, required=True)
    parser.add_argument("--provider-uncompressed-bytes", type=int, required=True)
    parser.add_argument("--readme-provider-uncompressed-bytes", type=int)
    parser.add_argument("--expected-parts", type=int, required=True)
    parser.add_argument("--wget", required=True)
    parser.add_argument("--md5", required=True)
    parser.add_argument("--sizes", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--readme", default="README.txt")
    parser.add_argument("--output", type=Path, required=True)
    inventory(parser.parse_args())


if __name__ == "__main__":
    main()
