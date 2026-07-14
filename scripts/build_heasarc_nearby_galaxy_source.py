#!/usr/bin/env python3
"""Download a compact, reproducible snapshot of HEASARC NEARGALCAT.

The HEASARC TAP service serializes this table as a VOTable BINARY stream.
Only the fields needed by the physical atlas are retained in the checked-in
JSON snapshot so catalog builds do not depend on a live network request.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import struct
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "sources" / "heasarc_neargalcat.json"
TAP_URL = "https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync"
QUERY = (
    "select name,ra,dec,major_axis,bmag,ks_mag,morph_type,distance,"
    "distance_method,class from neargalcat where distance > 0"
)


def download_votable() -> bytes:
    query = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "QUERY": QUERY})
    request = urllib.request.Request(f"{TAP_URL}?{query}", headers={"User-Agent": "Cosmic-Atlas-catalog-builder/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def read_value(payload: memoryview, offset: int, datatype: str, variable: bool) -> tuple[object, int]:
    if datatype == "char" and variable:
        length = struct.unpack_from(">I", payload, offset)[0]
        offset += 4
        value = bytes(payload[offset : offset + length]).decode("utf-8", errors="replace").strip()
        return value, offset + length
    if datatype == "double":
        return struct.unpack_from(">d", payload, offset)[0], offset + 8
    if datatype == "short":
        value = struct.unpack_from(">h", payload, offset)[0]
        return (None if value == -32768 else value), offset + 2
    raise ValueError(f"Unsupported VOTable datatype: {datatype}")


def parse_votable(document: bytes) -> list[dict[str, object]]:
    root = ET.fromstring(document)
    namespace = {"v": root.tag.partition("}")[0].lstrip("{")}
    table = root.find(".//v:TABLE", namespace)
    stream = root.find(".//v:STREAM", namespace)
    if table is None or stream is None or not stream.text:
        raise RuntimeError("HEASARC response did not contain a VOTable BINARY stream")
    fields = [
        (field.attrib["name"], field.attrib["datatype"], field.attrib.get("arraysize") == "*")
        for field in table.findall("v:FIELD", namespace)
    ]
    payload = memoryview(base64.b64decode("".join(stream.text.split())))
    rows: list[dict[str, object]] = []
    offset = 0
    while offset < len(payload):
        row: dict[str, object] = {}
        for name, datatype, variable in fields:
            value, offset = read_value(payload, offset, datatype, variable)
            if isinstance(value, float) and not math.isfinite(value):
                value = None
            row[name] = value
        rows.append(row)
    return rows


def build_snapshot(document: bytes) -> dict[str, object]:
    rows = parse_votable(document)
    if len(rows) < 700:
        raise RuntimeError(f"NEARGALCAT snapshot unexpectedly contained only {len(rows)} rows")
    rows.sort(key=lambda row: (float(row["distance"]), str(row["name"])))
    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "label": "HEASARC Updated Nearby Galaxy Catalog",
            "catalog": "NEARGALCAT",
            "url": "https://heasarc.gsfc.nasa.gov/W3Browse/galaxy-catalog/neargalcat.html",
            "tap_url": TAP_URL,
            "query": QUERY,
            "description": "All NEARGALCAT galaxies with a published positive distance estimate; positions are J2000 and distances are in Mpc.",
        },
        "object_count": len(rows),
        "objects": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="Parse an existing VOTable instead of downloading it")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    document = args.input.read_bytes() if args.input else download_votable()
    snapshot = build_snapshot(document)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {snapshot['object_count']} HEASARC nearby galaxies to {args.output}")


if __name__ == "__main__":
    main()
