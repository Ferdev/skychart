import bz2
from decimal import Decimal
import hashlib
import io
import sys
from pathlib import Path

import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import measure_irsa_bzip_partitions as irsa
from measure_irsa_bzip_partitions import download, measure, schema_from


SCHEMA = b"""## test schema ##
SOURCE_ID VARCHAR2(28 BYTE)
CNTR NUMBER(19,0)
RA NUMBER(10,7)
FLAG CHAR(4)
QUALITY SMALLINT
FLUX FLOAT
"""


def test_lossless_all_field_roundtrip_and_exact_uncompressed_accounting(tmp_path):
    raw = b"src-1|9007199254740993|12.1234567|ab  |7|1.25\nsrc-2|7|-1.0000000|\\N||\n"
    source = tmp_path / "source.bz2"
    source.write_bytes(bz2.compress(raw))
    detail = tmp_path / "detail.parquet"
    projection = tmp_path / "projection.parquet"
    schema = schema_from(SCHEMA)

    result = measure(source, detail, projection, schema, ["SOURCE_ID", "CNTR", "RA"], tmp_path, 0)

    assert result["rows"] == 2 and result["columns"] == 6
    assert result["uncompressed_bytes"] == len(raw)
    assert result["all_fields_verified"]
    table = pq.read_table(detail)
    assert table["CNTR"][0].as_py() == Decimal("9007199254740993")
    assert table["FLAG"][0].as_py() == "ab  "
    assert table["FLAG"][1].as_py() is None
    assert table["QUALITY"][1].as_py() is None
    assert table["FLUX"][1].as_py() is None
    assert pq.read_table(projection).num_columns == 3


def test_schema_preserves_declared_numeric_and_identifier_types():
    schema = schema_from(SCHEMA)
    assert str(schema.field("CNTR").type) == "decimal128(19, 0)"
    assert str(schema.field("RA").type) == "decimal128(10, 7)"
    assert str(schema.field("SOURCE_ID").type) == "string"


def test_accepts_only_an_empty_declared_record_terminator(tmp_path):
    schema = schema_from(SCHEMA)
    good = tmp_path / "good.bz2"
    raw = b"src-1|1|1.0000000|ok|2|3.0|\n"
    good.write_bytes(bz2.compress(raw))
    result = measure(good, tmp_path / "detail.parquet", tmp_path / "projection.parquet",
                     schema, ["SOURCE_ID"], tmp_path, 0, trailing_delimiter=True)
    assert result["empty_trailing_delimiter_verified"] is True

    bad = tmp_path / "bad.bz2"
    bad.write_bytes(bz2.compress(b"src-1|1|1.0000000|ok|2|3.0|unexpected\n"))
    with pytest.raises(ValueError, match="terminator"):
        measure(bad, tmp_path / "bad-detail.parquet", tmp_path / "bad-projection.parquet",
                schema, ["SOURCE_ID"], tmp_path, 0, trailing_delimiter=True)


def test_rejects_unsupported_schema_type(tmp_path):
    with pytest.raises(ValueError, match="unsupported"):
        schema_from(b"FIELD BINARY\n")


def test_rejects_malformed_or_extra_source_columns(tmp_path):
    source = tmp_path / "source.bz2"
    source.write_bytes(bz2.compress(b"id|1|1.0000000|flag|2|3.0|extra\n"))
    with pytest.raises(Exception):
        measure(source, tmp_path / "detail.parquet", tmp_path / "projection.parquet",
                schema_from(SCHEMA), ["SOURCE_ID"], tmp_path, 0)


class FakeResponse(io.BytesIO):
    def __init__(self, payload, *, status, headers=None):
        super().__init__(payload)
        self.status = status
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def test_source_download_resumes_a_manifest_pinned_http_range(tmp_path, monkeypatch):
    payload = bz2.compress(b"complete provider bytes" * 100)
    source = tmp_path / "source.tmp.bz2"
    offset = len(payload) // 3
    source.write_bytes(payload[:offset])

    def respond(request, timeout):
        assert timeout == 180
        assert request.get_header("Range") == f"bytes={offset}-"
        return FakeResponse(
            payload[offset:], status=206,
            headers={"Content-Range": f"bytes {offset}-{len(payload) - 1}/{len(payload)}"},
        )

    monkeypatch.setattr(irsa, "urlopen", respond)
    result = download(
        "https://example.invalid/source.bz2", source, len(payload),
        hashlib.md5(payload).hexdigest(), tmp_path, 0,
    )

    assert source.read_bytes() == payload
    assert result == {
        "sha256": hashlib.sha256(payload).hexdigest(),
        "resumed_bytes": offset,
        "downloaded_bytes": len(payload) - offset,
        "server_restarted_download": False,
    }


def test_source_download_restarts_safely_when_provider_ignores_range(tmp_path, monkeypatch):
    payload = bz2.compress(b"complete provider bytes" * 100)
    source = tmp_path / "source.tmp.bz2"
    source.write_bytes(payload[:17])

    monkeypatch.setattr(
        irsa, "urlopen",
        lambda request, timeout: FakeResponse(payload, status=200),
    )
    result = download(
        "https://example.invalid/source.bz2", source, len(payload),
        hashlib.md5(payload).hexdigest(), tmp_path, 0,
    )

    assert source.read_bytes() == payload
    assert result["resumed_bytes"] == 0
    assert result["downloaded_bytes"] == len(payload)
    assert result["server_restarted_download"] is True
