import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from inventory_s3_prefix import classify


def test_classifies_alternative_intensity_encodings_and_required_tables():
    prefix = "wise/allwise/images/p3am_cdd/00/0000/0000m016_ac51/0000m016_ac51"
    assert classify(prefix + "-w1-int-3.fits") == "product:intensity_fits_uncompressed"
    assert classify(prefix + "-w1-int-3.fits.gz") == "product:intensity_fits_gz"
    assert classify(prefix + "-w1-int-3.fits.gz.md5") == "checksum_sidecar:intensity_fits_gz"
    assert classify(prefix + "-mfflag-3.tbl") == "product:multiframe_flag_table"
