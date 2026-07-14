import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "download_gaia_dr3.py"
SPEC = importlib.util.spec_from_file_location("download_gaia_dr3", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class GaiaDownloadTests(unittest.TestCase):
    def test_manifest_parser_ignores_unrelated_lines(self):
        entries = MODULE.parse_manifest(
            "0123456789abcdef0123456789abcdef  GaiaSource_000000-003111.csv.gz\n"
            "not a manifest row\n"
        )
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].stem, "GaiaSource_000000-003111")

    def test_status_counts_only_final_parquet_files(self):
        entries = [
            MODULE.ArchiveEntry("0" * 32, "GaiaSource_000000-000001.csv.gz"),
            MODULE.ArchiveEntry("1" * 32, "GaiaSource_000002-000003.csv.gz"),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "parquet").mkdir()
            (root / "downloads").mkdir()
            (root / "parquet" / "GaiaSource_000000-000001.parquet").write_bytes(b"done")
            (root / "downloads" / "next.gz.part").write_bytes(b"partial")
            status = MODULE.build_status(root, entries)
        self.assertEqual(status["completed_files"], 1)
        self.assertEqual(status["remaining_files"], 1)
        self.assertEqual(status["partial_download_bytes"], 7)


if __name__ == "__main__":
    unittest.main()
