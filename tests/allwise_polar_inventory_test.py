import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from inventory_allwise_polar_images import parse_links


def page(missing=None):
    links = []
    for index in range(73):
        coadd = f"{index:04d}p001_ac52"
        for suffix in (".tar", "-framestat.tbl"):
            row = f'<a href="data/{coadd}{suffix}">product</a>'
            if (index, suffix) != missing:
                links.append(row)
    return "".join(links).encode()


def test_requires_both_products_for_all_73_coadds():
    rows = parse_links(page(), "https://example.test/release/page.html")
    assert len(rows) == 146
    assert len({row[0] for row in rows}) == 73
    assert rows[0][2].startswith("https://example.test/release/data/")


def test_rejects_missing_or_duplicate_link():
    with pytest.raises(ValueError, match="146 distinct"):
        parse_links(page((72, ".tar")))
    duplicate = page() + b'<a href="data/0000p001_ac52.tar">again</a>'
    with pytest.raises(ValueError, match="146 distinct"):
        parse_links(duplicate)
