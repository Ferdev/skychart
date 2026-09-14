import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from inventory_irsa_bulk_release import build_receipt


NAMES = {key: key + ".txt" for key in ("wget", "md5", "sizes", "schema", "readme")}


def fixture_blobs():
    return {
        "md5": b"0123456789abcdef0123456789abcdef  a.bz2\nabcdef0123456789abcdef0123456789  b.bz2\n",
        "sizes": b"-rw-r--r-- 1 irsa irsa 11 Jan 1 00:00 a.bz2\n-rw-r--r-- 1 irsa irsa 13 Jan 1 00:00 b.bz2\n",
        "wget": b"wget -x https://example.test/a.bz2\nwget -x https://example.test/b.bz2\n",
        "schema": b"## schema ##\nSOURCE_ID VARCHAR(20)\nRA NUMBER\nDEC NUMBER\n",
        "readme": b"complete release\n",
    }


def build(blobs=None):
    return build_receipt(
        blobs or fixture_blobs(), base_url="https://example.test/",
        catalog_id="test", provider_table="table", release="release",
        record_kind="observations", provider_rows=7,
        provider_uncompressed_bytes=101, expected_parts=2, names=NAMES,
    )


def test_reconciles_all_provider_manifests_and_labels_unknown_owned_storage():
    receipt = build()
    assert receipt["parts"] == 2
    assert receipt["provider_manifest_compressed_bytes"] == 24
    assert receipt["schema"]["fields"] == ["SOURCE_ID", "RA", "DEC"]
    assert receipt["source_bytes_measured"] is None
    assert receipt["owned_full_schema_bytes_measured"] is None
    assert receipt["serving_artifact_bytes_measured"] is None
    assert receipt["evidence_class"].startswith("provider_published_metadata")


def test_preserves_conflicting_provider_uncompressed_byte_claims():
    receipt = build_receipt(
        fixture_blobs(), base_url="https://example.test/",
        catalog_id="test", provider_table="table", release="release",
        record_kind="observations", provider_rows=7,
        provider_uncompressed_bytes=101, readme_provider_uncompressed_bytes=102,
        expected_parts=2, names=NAMES,
    )
    assert receipt["provider_reported_uncompressed_bytes"] == 101
    assert receipt["readme_provider_reported_uncompressed_bytes"] == 102
    assert receipt["provider_uncompressed_byte_claims_agree"] is False


@pytest.mark.parametrize("key,replacement", [
    ("sizes", b"-rw-r--r-- 1 irsa irsa 11 Jan 1 00:00 a.bz2\n"),
    ("wget", b"wget -x https://example.test/a.bz2\n"),
])
def test_rejects_incomplete_provider_metadata(key, replacement):
    blobs = copy.deepcopy(fixture_blobs())
    blobs[key] = replacement
    with pytest.raises(ValueError):
        build(blobs)


def test_rejects_release_part_count_drift():
    with pytest.raises(ValueError, match="part count"):
        build_receipt(
            fixture_blobs(), base_url="https://example.test/",
            catalog_id="test", provider_table="table", release="release",
            record_kind="observations", provider_rows=7,
            provider_uncompressed_bytes=101, expected_parts=3, names=NAMES,
        )
