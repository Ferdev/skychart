#!/usr/bin/env python3
"""Capture current IRSA TAP counts and schemas for AllWISE ancillary tables."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


TABLES = {
    "allwise_p3as_cdd": (18_240, "Atlas metadata"),
    "allwise_p3am_xrf": (21_208_389, "Atlas/frame cross-reference"),
    "allwise_p3al_lod": (18_240, "Atlas inventory"),
    "allwise_p3am_cdd": (72_960, "Atlas image inventory"),
    "allwise_mfpos": (2_786_053, "refined single-exposure pointing"),
}
TAP = "https://irsa.ipac.caltech.edu/TAP/sync"


def fetch(query):
    url = TAP + "?" + urlencode({"QUERY": query, "FORMAT": "csv", "LANG": "ADQL", "REQUEST": "doQuery"})
    request = Request(url, headers={"User-Agent": "SkyChart storage investigation/1271"})
    with urlopen(request, timeout=180) as response:
        data = response.read(5_000_001)
        if len(data) > 5_000_000:
            raise ValueError("TAP metadata response exceeds bound")
        return data, response.geturl()


def parse_count(data):
    rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"))))
    if len(rows) != 1 or set(rows[0]) != {"n"} or not rows[0]["n"].isdigit():
        raise ValueError("invalid TAP count response")
    return int(rows[0]["n"])


def build_receipt(count_blobs, schema_blob):
    schema_rows = list(csv.DictReader(io.StringIO(schema_blob.decode("utf-8"))))
    expected_columns = {"table_name", "column_name", "datatype", "unit", "description"}
    if not schema_rows or set(schema_rows[0]) != expected_columns:
        raise ValueError("invalid TAP schema response")
    schemas = {}
    for name in TABLES:
        rows = [row for row in schema_rows if row["table_name"] == name]
        if not rows or len({row["column_name"] for row in rows}) != len(rows):
            raise ValueError("missing or duplicate ancillary schema columns")
        schemas[name] = {
            "columns": len(rows),
            "column_manifest_sha256": hashlib.sha256(
                "\n".join(f"{row['column_name']}\0{row['datatype']}\0{row['unit']}" for row in rows).encode()
            ).hexdigest(),
        }
    if set(count_blobs) != set(TABLES):
        raise ValueError("ancillary count table set changed")
    tables = {}
    for name, (documented_rows, description) in TABLES.items():
        observed = parse_count(count_blobs[name])
        tables[name] = {
            "description": description,
            "observed_rows": observed,
            "documented_rows": documented_rows,
            "counts_agree": observed == documented_rows,
            "count_response_sha256": hashlib.sha256(count_blobs[name]).hexdigest(),
            **schemas[name],
        }
    return {
        "status": "COMPLETE_LIVE_PROVIDER_METADATA_SCOPE",
        "evidence_class": "live_TAP_metadata_not_source_export_or_owned_storage",
        "release": "AllWISE 2013 tables as exposed by current IRSA TAP",
        "observed_unix": time.time(),
        "tables": tables,
        "schema_response_sha256": hashlib.sha256(schema_blob).hexdigest(),
        "source_bytes_measured": None,
        "owned_serving_bytes_measured": None,
        "scope": (
            "Aggregate counts and advertised schemas from a mutable live TAP service. "
            "No table rows were exported, so this does not establish an atomic source snapshot "
            "or any owned/native-serving byte total."
        ),
    }


def inventory(root):
    root.mkdir(parents=True, exist_ok=True)
    count_blobs = {}
    urls = {}
    for name in TABLES:
        data, url = fetch(f"select count(*) as n from {name}")
        count_blobs[name] = data
        urls[name] = url
        (root / f"{name}.count.csv").write_bytes(data)
    predicates = " or ".join(f"table_name='{name}'" for name in TABLES)
    schema, schema_url = fetch(
        "select table_name,column_name,datatype,unit,description from TAP_SCHEMA.columns "
        f"where {predicates} order by table_name,column_name"
    )
    (root / "columns.csv").write_bytes(schema)
    receipt = build_receipt(count_blobs, schema)
    receipt["count_query_urls"] = urls
    receipt["schema_query_url"] = schema_url
    path = root / "scope.receipt.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)
    print(json.dumps(receipt, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    inventory(parser.parse_args().root)


if __name__ == "__main__":
    main()
