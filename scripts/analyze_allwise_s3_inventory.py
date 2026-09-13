#!/usr/bin/env python3
"""Derive exact AllWISE Atlas product bytes from a completed raw S3 listing."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import time
from xml.etree import ElementTree as ET

from inventory_s3_prefix import NS, classify, sha256


EXPECTED_PRODUCT_COUNTS = {
    "product:intensity_fits_uncompressed": 72_960,
    "product:intensity_fits_gz": 72_960,
    "product:coverage_fits_gz": 72_960,
    "product:uncertainty_fits_gz": 72_960,
    "product:multiframe_flag_table": 18_240,
    "product:artifact_table": 227_913,
}


def summarize(root):
    completed = json.loads((root / "inventory.receipt.json").read_text())
    if completed["status"] != "COMPLETE_PROVIDER_S3_PREFIX_INVENTORY":
        raise ValueError("completed S3 prefix receipt required")
    counts = Counter()
    sizes = Counter()
    manifest = hashlib.sha256()
    page_receipts = sorted((root / "pages").glob("*.receipt.json"))
    for index, receipt_path in enumerate(page_receipts):
        row = json.loads(receipt_path.read_text())
        raw_path = root / "pages" / f"{index:06d}.xml.gz"
        with gzip.open(raw_path, "rb") as stream:
            xml = stream.read()
        if sha256(xml) != row["raw_xml_sha256"]:
            raise ValueError("raw S3 listing page changed")
        page_manifest = hashlib.sha256()
        parsed = ET.fromstring(xml)
        for node in parsed.findall("s3:Contents", NS):
            key = node.findtext("s3:Key", namespaces=NS)
            value = int(node.findtext("s3:Size", namespaces=NS))
            etag = (node.findtext("s3:ETag", default="", namespaces=NS) or "").strip('"')
            kind = classify(key)
            counts[kind] += 1
            sizes[kind] += value
            page_manifest.update(key.encode())
            page_manifest.update(b"\0" + str(value).encode() + b"\0" + etag.encode() + b"\n")
        if page_manifest.hexdigest() != row["object_manifest_sha256"]:
            raise ValueError("page object manifest changed")
        manifest.update(page_manifest.hexdigest().encode() + b"\n")
    if len(page_receipts) != completed["pages"] or manifest.hexdigest() != completed["page_manifest_chain_sha256"]:
        raise ValueError("completed page chain changed")
    if sum(counts.values()) != completed["objects"] or sum(sizes.values()) != completed["provider_object_bytes"]:
        raise ValueError("derived category totals do not reconcile")
    for kind, expected in EXPECTED_PRODUCT_COUNTS.items():
        if counts[kind] != expected or counts["checksum_sidecar:" + kind.removeprefix("product:")] != expected:
            raise ValueError("AllWISE Atlas product/sidecar count changed: " + kind)
    unexpected = {key: value for key, value in counts.items()
                  if key.removeprefix("checksum_sidecar:").removeprefix("product:") not in
                  {name.removeprefix("product:") for name in EXPECTED_PRODUCT_COUNTS}}
    if unexpected:
        raise ValueError("unclassified AllWISE Atlas objects")
    excluded = (sizes["product:intensity_fits_uncompressed"] +
                sizes["checksum_sidecar:intensity_fits_uncompressed"])
    return {
        "status": "COMPLETE_PROVIDER_PRODUCT_BYTE_DERIVATION",
        "evidence_class": "provider_S3_metadata_not_downloaded_or_owned_storage",
        "observed_unix": time.time(),
        "objects": sum(counts.values()),
        "provider_prefix_bytes": sum(sizes.values()),
        "counts_by_category": dict(sorted(counts.items())),
        "bytes_by_category": dict(sorted(sizes.items())),
        "provider_compact_product_bytes": sum(sizes.values()) - excluded,
        "excluded_uncompressed_intensity_alternative_bytes": excluded,
        "encoding_deduplication": (
            "Select the provider's gzip intensity path and exclude its same-name uncompressed "
            "alternative plus sidecar. File naming documents the encoding relationship; "
            "decompressed byte equivalence was not independently measured."
        ),
        "owned_source_bytes_measured": None,
        "native_serving_bytes_measured": None,
        "page_manifest_chain_sha256": manifest.hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    result = summarize(args.root)
    path = args.root / "product-bytes.receipt.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
