#!/usr/bin/env python3
"""Guardrails for the SDSS-V DR20 SPIDERS DL1 catalog importer."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_importer():
    module_path = ROOT / "scripts" / "import_sdss_spiders_dr20_catalog.py"
    spec = importlib.util.spec_from_file_location("import_sdss_spiders_dr20_catalog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def base_record(**overrides):
    record = {
        "ero_detuid": "em01-123456-042",
        "sdss_catalogid": "76543210987654",
        "sdss_field": 112233,
        "sdss_mjd": 60412,
        "sdss_objtype": "QSO",
        "sdss_z": 1.234,
        "sdss_z_err": 0.0004,
        "sdss_zwarning": 0,
        "sdss_sn_median_all": 6.5,
        "sdss_class": "QSO",
        "sdss_subclass": "",
        "sdss_nspec": 2,
        "gaia_g": 20.3,
        "ero_ra": 152.75,
        "ero_dec": 11.4,
        "ero_flux": 2.0e-14,
        "ero_det_like": 25.0,
    }
    record.update(overrides)
    return record


class SdssSpidersDr20CatalogImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.importer = load_importer()
        cls.shared = sys.modules["catalog_pg_import"]

    def distance_mpc_for_z(self, redshift: float) -> float:
        return self.shared.comoving_distance_mpc(redshift)

    def build(self, record):
        return self.importer.build_object_row(
            record, now="2026-08-07T00:00:00", now_z="2026-08-07T00:00:00Z", distance_mpc_for_z=self.distance_mpc_for_z
        )

    def test_pinned_source_and_band(self) -> None:
        importer = self.importer
        self.assertIn("data.sdss.org/sas/dr20/vac/mos/DL1_SDSS_eROSITA/", importer.DL1_ALLEPOCH_URL)
        self.assertIn("allepoch", importer.DL1_ALLEPOCH_URL)
        self.assertLessEqual(importer.MIN_EXPECTED_RECORDS, 263_310)
        self.assertGreaterEqual(importer.MAX_EXPECTED_RECORDS, 263_310)

    def test_class_mapping(self) -> None:
        self.assertEqual(self.importer.OBJECT_TYPE_BY_SDSS_CLASS["QSO"], "quasar")
        self.assertEqual(self.importer.OBJECT_TYPE_BY_SDSS_CLASS["GALAXY"], "galaxy")
        self.assertEqual(self.importer.OBJECT_TYPE_BY_SDSS_CLASS["STAR"], "star")

    def test_qso_with_good_redshift(self) -> None:
        row = self.build(base_record())
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["object_type"], "quasar")
        self.assertEqual(values["catalog_group"], "sdss_spiders_dr20")
        self.assertEqual(values["source_type"], "sdss_spiders_dr20_dl1")
        self.assertEqual(values["position_model"], "catalog_inferred_spectroscopic_redshift_comoving")
        expected_pc = self.shared.comoving_distance_mpc(1.234) * 1.0e6
        self.assertAlmostEqual(values["distance_pc"], expected_pc, delta=expected_pc * 1e-6)
        facts = json.loads(values["facts"])
        self.assertEqual(facts["redshift"], 1.234)
        self.assertEqual(facts["redshift_kind"], "sdss_boss_spectroscopic")
        self.assertEqual(facts["sdss_zwarning"], 0)
        self.assertEqual(facts["sdss_sn_median_all"], 6.5)
        self.assertNotIn("distance_unknown", facts)

    def test_zwarning_forces_reference_shell(self) -> None:
        row = self.build(base_record(sdss_zwarning=16))
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["position_model"], "catalog_sky_position_reference_shell")
        facts = json.loads(values["facts"])
        self.assertTrue(facts["distance_unknown"])
        self.assertEqual(facts["sdss_zwarning"], 16)
        self.assertNotIn("redshift", facts)

    def test_star_class_uses_shell(self) -> None:
        row = self.build(base_record(sdss_class="STAR", sdss_z=0.0))
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["object_type"], "star")
        self.assertEqual(values["position_model"], "catalog_sky_position_reference_shell")

    def test_unknown_class_defaults_to_xray_source(self) -> None:
        row = self.build(base_record(sdss_class="", sdss_objtype="QSO"))
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["object_type"], "xray_source")

    def test_search_text_and_identity(self) -> None:
        row = self.build(base_record())
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["key"], "sdss-spiders-dr20-76543210987654")
        self.assertEqual(values["name"], "SPIDERS DR20 76543210987654")
        self.assertEqual(values["source_identifier"], "76543210987654")
        self.assertIn("spiders", values["search_text"])
        self.assertIn("erosita", values["search_text"])
        self.assertIn("76543210987654", values["search_text"])
        external_ids = json.loads(values["external_ids"])
        self.assertEqual(external_ids["sdss_catalogid"], "76543210987654")
        self.assertEqual(external_ids["erosita_detuid"], "em01-123456-042")

    def test_missing_identity_or_position_rejected(self) -> None:
        self.assertIsNone(self.build(base_record(sdss_catalogid="")))
        self.assertIsNone(self.build(base_record(ero_ra=None)))
        self.assertIsNone(self.build(base_record(ero_dec=120.0)))


if __name__ == "__main__":
    unittest.main()
