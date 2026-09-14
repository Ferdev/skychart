import gzip
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from inventory_s3_prefix import accumulate, load_pages, parse_page


def xml(keys, truncated=False, token=None):
    contents = "".join(
        f"<Contents><Key>{key}</Key><ETag>\"{index:032x}\"</ETag><Size>{index + 10}</Size></Contents>"
        for index, key in enumerate(keys)
    )
    continuation = f"<NextContinuationToken>{token}</NextContinuationToken>" if token else ""
    return (
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        f"<IsTruncated>{str(truncated).lower()}</IsTruncated>{contents}{continuation}</ListBucketResult>"
    ).encode()


def test_page_preserves_categories_sizes_and_coadd_identity():
    page = parse_page(xml([
        "wise/allwise/images/p3am_cdd/00/0000/0000m016_ac51/0000m016_ac51-w1-int-3.fits",
        "wise/allwise/images/p3am_cdd/00/0000/0000m016_ac51/0000m016_ac51-w1-int-3.fits.md5",
    ], True, "next"), None)
    assert page["objects"] == 2
    assert page["bytes"] == 21
    assert page["primary_product_bytes"] == 10
    assert page["checksum_sidecar_bytes"] == 11
    assert page["coadd_ids"] == ["0000m016_ac51"]
    assert page["categories"] == {
        "checksum_sidecar:intensity_fits_uncompressed": 1,
        "product:intensity_fits_uncompressed": 1,
    }
    assert page["next_token"] == "next"


def test_rejects_inconsistent_continuation_and_unordered_keys():
    with pytest.raises(ValueError, match="continuation"):
        parse_page(xml(["a"], True, None), None)
    with pytest.raises(ValueError, match="ordered"):
        parse_page(xml(["b", "a"]), None)


def test_load_pages_revalidates_raw_xml_and_chain(tmp_path):
    pages = tmp_path / "pages"
    pages.mkdir()
    raw = xml(["a"], True, "next")
    row = parse_page(raw, None)
    with gzip.GzipFile(filename=str(pages / "000000.xml.gz"), mode="wb", mtime=0) as stream:
        stream.write(raw)
    (pages / "000000.receipt.json").write_text(json.dumps(row))
    receipts, totals, _, _, token, last = load_pages(tmp_path)
    assert len(receipts) == 1
    assert totals["bytes"] == 10
    assert token == "next" and last == "a"
    (pages / "000000.xml.gz").write_bytes(b"broken")
    with pytest.raises(Exception):
        load_pages(tmp_path)


def test_incremental_accumulator_matches_page_totals():
    from collections import Counter

    row = parse_page(xml(["a", "b"]), None)
    totals = Counter()
    coadds = set()
    hashes = []
    accumulate(totals, coadds, hashes, row)
    assert totals["objects"] == row["objects"]
    assert totals["bytes"] == row["bytes"]
    assert hashes == [row["object_manifest_sha256"]]
