import json
from pathlib import Path
import sqlite3
import sys

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from measure_desi_angular_index import measure
from measure_gaia_full_partitions import sha


def test_angular_index_retains_exact_positions_and_excludes_invalid_coordinates(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    parts = []
    tables = [
        pa.table({"TARGET_RA": [0.0, None], "TARGET_DEC": [0.0, 4.0]}),
        pa.table({"TARGET_RA": [359.9, 360.0], "TARGET_DEC": [-90.0, 1.0]}),
    ]
    start = 0
    for slot, table in enumerate(tables):
        name = f"part-{slot}.parquet"
        pq.write_table(table, source / name, row_group_size=1)
        stop = start + len(table)
        parts.append(
            {
                "hdu": 1,
                "source_start": start,
                "source_stop": stop,
                "rows": len(table),
                "file": name,
                "all_fields_verified": True,
                "sha256": sha(source / name),
            }
        )
        start = stop
    measurement = {
        "status": "FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED",
        "source_sha256": "a" * 64,
        "partitions": parts,
        "rows": 4,
        "expected_rows": 4,
    }
    (source / "measurement.json").write_text(json.dumps(measurement) + "\n")

    output = tmp_path / "output"
    first = measure(source, output, floor=0)
    second = measure(source, output, floor=0)

    assert first == second
    assert first["rows"] == 4
    assert first["angular_rows"] == 2
    assert first["rows_without_valid_angular_position"] == 2
    with sqlite3.connect(output / "angular.sqlite") as db:
        assert db.execute("SELECT ordinal,ra,dec FROM positions ORDER BY ordinal").fetchall() == [
            (0, 0.0, 0.0),
            (2, 359.9, -90.0),
        ]
        assert db.execute("SELECT rtreecheck('angular')").fetchone() == ("ok",)


def test_angular_index_rejects_partition_gaps(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    table = pa.table({"TARGET_RA": [1.0], "TARGET_DEC": [2.0]})
    pq.write_table(table, source / "part.parquet")
    measurement = {
        "status": "FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED",
        "source_sha256": "b" * 64,
        "partitions": [
            {
                "hdu": 1,
                "source_start": 1,
                "source_stop": 2,
                "rows": 1,
                "file": "part.parquet",
                "all_fields_verified": True,
                "sha256": sha(source / "part.parquet"),
            }
        ],
        "rows": 1,
        "expected_rows": 1,
    }
    (source / "measurement.json").write_text(json.dumps(measurement) + "\n")

    try:
        measure(source, tmp_path / "output", floor=0)
    except ValueError as error:
        assert "gap" in str(error)
    else:
        raise AssertionError("partition gap was accepted")
