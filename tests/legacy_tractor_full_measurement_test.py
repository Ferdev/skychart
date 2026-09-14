import hashlib
import json
from pathlib import Path
import sys

import fitsio
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import measure_legacy_tractor_full as module


def source(path, first):
    rows = np.zeros(3, dtype=[
        ("release", ">i2"), ("brickid", ">i4"), ("objid", ">i4"),
        ("ra", ">f8"), ("dec", ">f8"), ("flux", ">f4", (2,)),
    ])
    rows["release"] = 10_000
    rows["brickid"] = first
    rows["objid"] = np.arange(3)
    rows["ra"] = [0.0, 1.0, 2.0]
    rows["dec"] = [-1.0, 0.0, 1.0]
    rows["flux"][1, 1] = np.nan
    fitsio.write(path, rows, clobber=True)


def fixture(tmp_path):
    provider = tmp_path / "provider" / "000"
    provider.mkdir(parents=True)
    names = ["tractor-0001m002.fits", "tractor-0001m005.fits"]
    lines = []
    for index, name in enumerate(names):
        source(provider / name, index + 1)
        digest = hashlib.sha256((provider / name).read_bytes()).hexdigest()
        lines.append(f"{digest} *{name}")
    manifests = tmp_path / "manifests"
    manifests.mkdir()
    (manifests / "000.sha256sum").write_text("\n".join(lines) + "\n")
    return provider.parent.as_uri() + "/", manifests, tmp_path / "output"


def test_sequential_resume_recycles_only_verified_temporaries(tmp_path, monkeypatch):
    base, manifests, output = fixture(tmp_path)
    monkeypatch.setattr(module, "guard", lambda *args: None)
    monkeypatch.setattr("measure_fits_table_storage.guard", lambda *args: None)

    partial = module.measure(output, manifests, base, expected_files=2,
                             free_floor=0, max_files=1)
    assert partial["status"] == "INCOMPLETE"
    assert partial["files"] == 1 and partial["rows"] == 3
    assert not (output / "source.tmp.fits").exists()
    assert not (output / "audit.tmp.json").exists()
    assert not (output / "detail.tmp").exists()
    receipt = json.loads((output / "receipts/000000.json").read_text())
    assert receipt["all_fields_verified"] is True
    assert receipt["columns_by_table"] == [6]
    stamp = (output / "receipts/000000.json").stat().st_mtime_ns

    complete = module.measure(output, manifests, base, expected_files=2,
                              free_floor=0)
    assert complete["status"] == "FULL_TRACTOR_SOURCE_AND_CANDIDATE_DETAIL_MEASURED"
    assert complete["files"] == 2 and complete["rows"] == 6
    assert complete["source_bytes"] > 0 and complete["candidate_detail_bytes"] > 0
    assert complete["full_serving_bytes"] is None
    assert (output / "receipts/000000.json").stat().st_mtime_ns == stamp
    repeated = module.measure(output, manifests, base, expected_files=2,
                              free_floor=0)
    assert repeated["source_bytes"] == complete["source_bytes"]


def test_changed_manifest_or_truncated_source_cannot_be_accepted(tmp_path, monkeypatch):
    base, manifests, output = fixture(tmp_path)
    monkeypatch.setattr(module, "guard", lambda *args: None)
    monkeypatch.setattr("measure_fits_table_storage.guard", lambda *args: None)
    module.measure(output, manifests, base, expected_files=2, free_floor=0,
                   max_files=1)
    lines = (manifests / "000.sha256sum").read_text().splitlines()
    lines[1] = "0" * 64 + " *tractor-0001m005.fits"
    (manifests / "000.sha256sum").write_text("\n".join(lines) + "\n")
    with pytest.raises(ValueError, match="release or measurement contract changed"):
        module.measure(output, manifests, base, expected_files=2, free_floor=0)


def test_manifest_rejects_wrong_directory_prefix(tmp_path):
    manifests = tmp_path / "manifests"
    manifests.mkdir()
    (manifests / "000.sha256sum").write_text(
        "0" * 64 + " *tractor-0011m002.fits\n"
    )
    with pytest.raises(ValueError, match="unsafe or misplaced"):
        module.manifest_entries(manifests)
