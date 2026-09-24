from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from collect_remote_storage_receipts import continuous_receipt_count


def test_incremental_checkpoint_requires_contiguous_receipts(tmp_path):
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    (receipts / "00000.json").write_text("{}")
    (receipts / "00001.json").write_text("{}")
    assert continuous_receipt_count(receipts) == 2
    (receipts / "00003.json").write_text("{}")
    with pytest.raises(ValueError, match="not contiguous"):
        continuous_receipt_count(receipts)
