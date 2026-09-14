import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from inventory_allwise_ancillary_tables import TABLES, build_receipt


def schema_blob():
    rows = ["table_name,column_name,datatype,unit,description"]
    for name in TABLES:
        rows.append(f'{name},id,long,,"identifier"')
    return ("\n".join(rows) + "\n").encode()


def test_keeps_ancillary_rows_as_live_provider_metadata():
    counts = {name: f"n\n{expected}\n".encode() for name, (expected, _) in TABLES.items()}
    receipt = build_receipt(counts, schema_blob())
    assert receipt["status"] == "COMPLETE_LIVE_PROVIDER_METADATA_SCOPE"
    assert all(row["counts_agree"] for row in receipt["tables"].values())
    assert receipt["source_bytes_measured"] is None
    assert receipt["owned_serving_bytes_measured"] is None


def test_rejects_missing_table_or_duplicate_schema_field():
    counts = {name: f"n\n{expected}\n".encode() for name, (expected, _) in TABLES.items()}
    counts.pop(next(iter(counts)))
    with pytest.raises(ValueError, match="table set"):
        build_receipt(counts, schema_blob())
    duplicate = schema_blob() + schema_blob().splitlines()[1] + b"\n"
    with pytest.raises(ValueError, match="duplicate"):
        build_receipt({name: f"n\n{expected}\n".encode() for name, (expected, _) in TABLES.items()}, duplicate)
