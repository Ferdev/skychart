#!/usr/bin/env python3
"""Inventory all 73 linked AllWISE full-depth polar image sets by HEAD."""
import argparse
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin
from urllib.request import Request, urlopen


PAGE = "https://irsa.ipac.caltech.edu/data/WISE/docs/release/AllWISE/expsup/sec4_5.html"
LINK_RE = re.compile(r"(?:^|/)(\d{4}[mp]\d{3}_ac52)(\.tar|-framestat\.tbl)$")
OWNER = "SkyChart isolated AllWISE full-depth polar inventory 1271\n"


class Links(HTMLParser):
    def __init__(self, base):
        super().__init__()
        self.base = base
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if not href:
            return
        url = urljoin(self.base, href)
        match = LINK_RE.search(url)
        if match:
            self.rows.append((match.group(1), "image_tar" if match.group(2) == ".tar" else "frame_cross_reference", url))


def parse_links(html, base=PAGE):
    parser = Links(base)
    parser.feed(html.decode("utf-8"))
    if len(parser.rows) != 146 or len(set(parser.rows)) != 146:
        raise ValueError("official page does not contain 146 distinct product links")
    coadds = {row[0] for row in parser.rows}
    if len(coadds) != 73:
        raise ValueError("official page does not contain 73 polar coadds")
    for coadd in coadds:
        kinds = {kind for found, kind, _ in parser.rows if found == coadd}
        if kinds != {"image_tar", "frame_cross_reference"}:
            raise ValueError("polar coadd does not have both linked products")
    return parser.rows


def save(path, value):
    data = json.dumps(value, indent=2, sort_keys=True) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(data)
    temporary.replace(path)


def fetch(url, method="GET", limit=1_000_000):
    error = None
    for attempt in range(5):
        try:
            request = Request(url, method=method, headers={"User-Agent": "SkyChart storage investigation/1271"})
            with urlopen(request, timeout=60) as response:
                data = response.read(limit + 1) if method == "GET" else b""
                if len(data) > limit:
                    raise ValueError("official page exceeds bound")
                return data, response
        except Exception as exc:
            error = exc
            time.sleep(min(2 ** attempt, 16))
    raise error


def inventory(args):
    args.root.mkdir(parents=True, exist_ok=True)
    owner = args.root / "OWNER"
    if owner.exists() and owner.read_text() != OWNER:
        raise ValueError("unowned output root")
    if not owner.exists():
        owner.write_text(OWNER)
    html, response = fetch(PAGE)
    (args.root / "official-page.html").write_bytes(html)
    rows = parse_links(html, response.geturl())
    receipts = args.root / "files"
    receipts.mkdir(exist_ok=True)
    for index, (coadd, kind, url) in enumerate(rows):
        path = receipts / f"{index:03d}.json"
        if path.exists():
            prior = json.loads(path.read_text())
            if (prior["coadd_id"], prior["kind"], prior["url"]) != (coadd, kind, url):
                raise ValueError("durable linked-product receipt changed")
            continue
        _, head = fetch(url, method="HEAD")
        length = head.headers.get("Content-Length")
        if head.status != 200 or not length or not length.isdigit():
            raise ValueError("linked product has no exact Content-Length")
        save(path, {
            "coadd_id": coadd, "kind": kind, "url": url,
            "final_url": head.geturl(), "bytes": int(length),
            "last_modified": head.headers.get("Last-Modified"),
            "etag": head.headers.get("ETag"), "observed_unix": time.time(),
        })
        save(args.root / "progress.json", {
            "status": "INCOMPLETE", "files": index + 1, "expected_files": 146,
            "observed_unix": time.time(),
        })
    values = [json.loads(path.read_text()) for path in sorted(receipts.glob("*.json"))]
    if len(values) != 146:
        raise ValueError("incomplete linked-product inventory")
    totals = {kind: sum(row["bytes"] for row in values if row["kind"] == kind)
              for kind in ("image_tar", "frame_cross_reference")}
    receipt = {
        "status": "COMPLETE_PROVIDER_LINK_AND_SIZE_INVENTORY",
        "evidence_class": "provider_HTTP_metadata_not_downloaded_or_owned_storage",
        "release": "AllWISE 2013 full-depth ecliptic polar atlas",
        "documentation_url": PAGE,
        "documentation_sha256": hashlib.sha256(html).hexdigest(),
        "coadd_ids": 73, "files": 146,
        "provider_image_tar_bytes": totals["image_tar"],
        "provider_frame_cross_reference_bytes": totals["frame_cross_reference"],
        "provider_total_bytes": sum(totals.values()),
        "checksums_available_in_response": sum(bool(row["etag"]) for row in values),
        "source_bytes_measured": None, "owned_serving_bytes_measured": None,
        "observed_unix": time.time(),
        "scope": (
            "Exact Content-Length values for every product linked by the official 73-row page. "
            "The products were not downloaded or checksummed locally; this is provider metadata, "
            "not measured owned or native-serving storage."
        ),
    }
    save(args.root / "inventory.receipt.json", receipt)
    save(args.root / "progress.json", receipt)
    print(json.dumps(receipt, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    inventory(parser.parse_args())


if __name__ == "__main__":
    main()
