#!/usr/bin/env python3
"""Focused guardrails for the BASS DR2 black-hole catalog builder."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_builder():
    module_path = ROOT / "scripts" / "build_bass_dr2_black_holes_catalog.py"
    spec = importlib.util.spec_from_file_location("build_bass_dr2_black_holes_catalog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class BassDr2BlackHolesCatalogTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.builder = load_builder()

    def test_query_and_provenance_pin_the_verified_source(self) -> None:
        self.assertEqual(self.builder.TABLE_ID, "J/ApJS/261/2/table9")
        self.assertIn('"logMBH" IS NOT NULL', self.builder.QUERY)
        self.assertIn('"Dist" > 0', self.builder.QUERY)
        self.assertEqual(self.builder.PAPER_URL, "https://doi.org/10.3847/1538-4365/ac6c05")

    def test_build_object_requires_mass_distance_and_valid_coordinates(self) -> None:
        row = {
            "ID": 42,
            "m_ID": "A",
            "SWIFT": "J0001.0+0001",
            "CName": "Example AGN",
            "RAJ2000": 12.5,
            "DEJ2000": -3.25,
            "Type": "Sy1",
            "z": 0.05,
            "ztype": "spec",
            "Dist": 220.0,
            "logMBH": 8.0,
            "Method": "Hbeta",
            "logLbol": 44.5,
            "logEdd": -1.2,
            "SimbadName": "SIMBAD example",
        }
        obj = self.builder.build_object(row)
        self.assertIsNotNone(obj)
        assert obj is not None
        self.assertEqual(obj["key"], "bass-dr2-black-hole-42a")
        self.assertEqual(obj["object_type"], "black_hole")
        self.assertEqual(obj["catalog_group"], "bass_dr2_black_holes")
        self.assertAlmostEqual(obj["radius_km"], self.builder.SCHWARZSCHILD_RADIUS_KM_PER_SOLAR_MASS * 1e8)
        self.assertIn("mass estimate", obj["facts"]["scientific_semantics"])

        for field, value in (("logMBH", None), ("logMBH", float("nan")), ("Dist", 0), ("Dist", -1)):
            invalid = dict(row)
            invalid[field] = value
            self.assertIsNone(self.builder.build_object(invalid))

        with self.assertRaisesRegex(ValueError, "row width"):
            self.builder.build_catalog({"data": [[42, "A"]]})

    def test_generated_snapshot_has_expected_real_records_and_semantics(self) -> None:
        snapshot = json.loads((ROOT / "data" / "catalogs" / "bass_dr2_black_holes.json").read_text(encoding="utf-8"))
        objects = snapshot["objects"]
        self.assertEqual(snapshot["object_count"], 790)
        self.assertEqual(len(objects), 790)
        self.assertEqual(len({obj["key"] for obj in objects}), 790)
        self.assertEqual(snapshot["source"]["vizier_table"], "J/ApJS/261/2/table9")
        self.assertIn("not direct horizon detections", snapshot["selection"]["scientific_scope"])

        for obj in objects:
            self.assertEqual(obj["object_type"], "black_hole")
            self.assertEqual(obj["catalog_group"], "bass_dr2_black_holes")
            self.assertEqual(obj["source_type"], "bass_dr2_black_hole_mass")
            self.assertTrue(0 <= obj["ra_deg"] < 360)
            self.assertTrue(-90 <= obj["dec_deg"] <= 90)
            self.assertGreater(obj["distance_ly"], 0)
            self.assertGreater(obj["radius_km"], 0)
            self.assertTrue(math.isfinite(obj["facts"]["black_hole_mass_log10_solar"]))
            self.assertGreater(obj["facts"]["catalog_distance_mpc"], 0)
            self.assertEqual(obj["facts"]["source_table"], "J/ApJS/261/2/table9")


if __name__ == "__main__":
    unittest.main()
