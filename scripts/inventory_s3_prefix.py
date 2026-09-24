#!/usr/bin/env python3
"""Build a durable exact-byte inventory for one public S3 prefix.

ListObjects metadata is provider evidence.  The command retains every raw XML
page and a verified page receipt, but it does not download the listed products
or claim that their owned/native SkyChart representations have been measured.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
OWNER = "SkyChart isolated S3 prefix inventory 1271\n"
COADD_RE = re.compile(r"/(\d{4}[mp]\d{3}_ac51)/")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def save_json(path, value):
    data = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def classify(key):
    sidecar = key.endswith(".md5")
    product = key[:-4] if sidecar else key
    name = product.rsplit("/", 1)[-1]
    if name.endswith("-int-3.fits.gz"):
        kind = "intensity_fits_gz"
    elif name.endswith("-int-3.fits"):
        kind = "intensity_fits_uncompressed"
    elif name.endswith("-cov-3.fits.gz"):
        kind = "coverage_fits_gz"
    elif name.endswith("-unc-3.fits.gz"):
        kind = "uncertainty_fits_gz"
    elif "-art-w" in name and name.endswith(".tbl"):
        kind = "artifact_table"
    elif name.endswith("-mfflag-3.tbl"):
        kind = "multiframe_flag_table"
    elif name.endswith(".tbl"):
        kind = "ancillary_table"
    else:
        kind = "other"
    return ("checksum_sidecar:" if sidecar else "product:") + kind


def parse_page(xml, request_token):
    root = ET.fromstring(xml)
    rows = []
    for node in root.findall("s3:Contents", NS):
        key = node.findtext("s3:Key", namespaces=NS)
        size_text = node.findtext("s3:Size", namespaces=NS)
        etag = (node.findtext("s3:ETag", default="", namespaces=NS) or "").strip('"')
        if not key or not size_text or not size_text.isdigit():
            raise ValueError("invalid S3 object metadata")
        rows.append((key, int(size_text), etag))
    if not rows or len({key for key, _, _ in rows}) != len(rows):
        raise ValueError("empty page or duplicate S3 key")
    if rows != sorted(rows):
        raise ValueError("S3 page keys are not ordered")
    truncated = root.findtext("s3:IsTruncated", namespaces=NS) == "true"
    next_token = root.findtext("s3:NextContinuationToken", namespaces=NS)
    if truncated != bool(next_token):
        raise ValueError("S3 continuation metadata is inconsistent")
    categories = Counter()
    coadds = set()
    primary_bytes = sidecar_bytes = 0
    manifest = hashlib.sha256()
    for key, size, etag in rows:
        categories[classify(key)] += 1
        if key.endswith(".md5"):
            sidecar_bytes += size
        else:
            primary_bytes += size
        match = COADD_RE.search(key)
        if match:
            coadds.add(match.group(1))
        manifest.update(key.encode())
        manifest.update(b"\0" + str(size).encode() + b"\0" + etag.encode() + b"\n")
    return {
        "request_token": request_token,
        "next_token": next_token,
        "objects": len(rows),
        "bytes": primary_bytes + sidecar_bytes,
        "primary_product_bytes": primary_bytes,
        "checksum_sidecar_bytes": sidecar_bytes,
        "first_key": rows[0][0],
        "last_key": rows[-1][0],
        "categories": dict(sorted(categories.items())),
        "coadd_ids": sorted(coadds),
        "object_manifest_sha256": manifest.hexdigest(),
        "raw_xml_sha256": sha256(xml),
        "single_part_etags": sum(bool(etag) and "-" not in etag for _, _, etag in rows),
        "multipart_etags": sum("-" in etag for _, _, etag in rows),
    }


def fetch_page(endpoint, prefix, token):
    params = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
    if token:
        params["continuation-token"] = token
    url = endpoint.rstrip("/") + "/?" + urlencode(params)
    error = None
    for attempt in range(5):
        try:
            request = Request(url, headers={"User-Agent": "SkyChart storage investigation/1271"})
            with urlopen(request, timeout=90) as response:
                data = response.read(2_000_001)
            if len(data) > 2_000_000:
                raise ValueError("S3 listing page exceeded bound")
            return data
        except Exception as exc:  # retry provider/network failures without losing pages
            error = exc
            time.sleep(min(2 ** attempt, 16))
    raise error


def load_pages(root):
    totals = Counter()
    coadds = set()
    hashes = []
    next_token = None
    last_key = None
    receipts = sorted((root / "pages").glob("*.receipt.json"))
    for index, path in enumerate(receipts):
        if path.name != f"{index:06d}.receipt.json":
            raise ValueError("non-contiguous page receipts")
        row = json.loads(path.read_text())
        raw_path = root / "pages" / f"{index:06d}.xml.gz"
        with gzip.open(raw_path, "rb") as stream:
            raw = stream.read()
        if sha256(raw) != row["raw_xml_sha256"] or row["request_token"] != next_token:
            raise ValueError("page receipt or continuation changed")
        if last_key is not None and row["first_key"] <= last_key:
            raise ValueError("S3 keys overlap across pages")
        totals["objects"] += row["objects"]
        totals["bytes"] += row["bytes"]
        totals["primary_product_bytes"] += row["primary_product_bytes"]
        totals["checksum_sidecar_bytes"] += row["checksum_sidecar_bytes"]
        for key, value in row["categories"].items():
            totals["category:" + key] += value
        coadds.update(row["coadd_ids"])
        hashes.append(row["object_manifest_sha256"])
        next_token = row["next_token"]
        last_key = row["last_key"]
    return receipts, totals, coadds, hashes, next_token, last_key


def accumulate(totals, coadds, hashes, row):
    totals["objects"] += row["objects"]
    totals["bytes"] += row["bytes"]
    totals["primary_product_bytes"] += row["primary_product_bytes"]
    totals["checksum_sidecar_bytes"] += row["checksum_sidecar_bytes"]
    for key, value in row["categories"].items():
        totals["category:" + key] += value
    coadds.update(row["coadd_ids"])
    hashes.append(row["object_manifest_sha256"])


def inventory(args):
    args.root.mkdir(parents=True, exist_ok=True)
    owner = args.root / "OWNER"
    if owner.exists() and owner.read_text() != OWNER:
        raise ValueError("unowned output root")
    if not owner.exists():
        owner.write_text(OWNER)
    (args.root / "pages").mkdir(exist_ok=True)
    receipts, totals, coadds, hashes, token, last_key = load_pages(args.root)
    while True:
        if receipts and token is None:
            break
        if args.max_pages is not None and len(receipts) >= args.max_pages:
            break
        xml = fetch_page(args.endpoint, args.prefix, token)
        row = parse_page(xml, token)
        if last_key is not None and row["first_key"] <= last_key:
            raise ValueError("new S3 page overlaps durable pages")
        index = len(receipts)
        raw_path = args.root / "pages" / f"{index:06d}.xml.gz"
        temporary = raw_path.with_suffix(raw_path.suffix + ".tmp")
        with temporary.open("wb") as output:
            with gzip.GzipFile(fileobj=output, mode="wb", mtime=0) as zipped:
                zipped.write(xml)
        temporary.replace(raw_path)
        receipt_path = args.root / "pages" / f"{index:06d}.receipt.json"
        save_json(receipt_path, row)
        receipts.append(receipt_path)
        accumulate(totals, coadds, hashes, row)
        token = row["next_token"]
        last_key = row["last_key"]
        progress = {
            "status": "INCOMPLETE" if token else "LISTING_COMPLETE_VALIDATION_PENDING",
            "pages": len(receipts), "objects": totals["objects"],
            "bytes": totals["bytes"], "coadd_ids": len(coadds),
            "next_token_present": bool(token), "last_key": last_key,
            "observed_unix": time.time(),
        }
        save_json(args.root / "progress.json", progress)
        if args.delay_seconds:
            time.sleep(args.delay_seconds)
    receipts, totals, coadds, hashes, token, last_key = load_pages(args.root)
    if token is not None:
        return
    if args.expected_coadd_ids is not None and len(coadds) != args.expected_coadd_ids:
        raise ValueError("provider coadd count differs from pinned release")
    chain = hashlib.sha256()
    for value in hashes:
        chain.update(value.encode() + b"\n")
    receipt = {
        "status": "COMPLETE_PROVIDER_S3_PREFIX_INVENTORY",
        "evidence_class": "provider_object_metadata_not_downloaded_or_owned_storage",
        "observed_unix": time.time(),
        "endpoint": args.endpoint,
        "prefix": args.prefix,
        "pages": len(receipts),
        "objects": totals["objects"],
        "provider_object_bytes": totals["bytes"],
        "provider_primary_product_bytes": totals["primary_product_bytes"],
        "provider_checksum_sidecar_bytes": totals["checksum_sidecar_bytes"],
        "coadd_ids": len(coadds),
        "expected_coadd_ids": args.expected_coadd_ids,
        "categories": {key.removeprefix("category:"): value for key, value in totals.items() if key.startswith("category:")},
        "page_manifest_chain_sha256": chain.hexdigest(),
        "first_key": json.loads(receipts[0].read_text())["first_key"],
        "last_key": last_key,
        "source_bytes_measured": None,
        "owned_serving_bytes_measured": None,
        "scope": (
            "Exact bytes and ETags from a complete public S3 ListObjectsV2 prefix inventory. "
            "Products were not downloaded or checksummed locally; S3 ETags are retained in the "
            "durable raw pages and are not assumed to be MD5 for multipart objects."
        ),
    }
    save_json(args.root / "inventory.receipt.json", receipt)
    save_json(args.root / "progress.json", {**receipt, "status": receipt["status"]})
    print(json.dumps(receipt, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--expected-coadd-ids", type=int)
    parser.add_argument("--delay-seconds", type=float, default=0.05)
    parser.add_argument("--max-pages", type=int)
    inventory(parser.parse_args())


if __name__ == "__main__":
    main()
