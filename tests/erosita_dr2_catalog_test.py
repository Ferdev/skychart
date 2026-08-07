#!/usr/bin/env python3
"""Guardrails for the eROSITA-DE DR2 catalog importer."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_importer():
    module_path = ROOT / "scripts" / "import_erosita_dr2_catalog.py"
    spec = importlib.util.spec_from_file_location("import_erosita_dr2_catalog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def base_record(**overrides):
    record = {
        "iauname": "3eRASS J000646.9-332308",
        "detuid": "sb03_002123_020_ML00005_001_c030",
        "ra_deg": 1.6954,
        "dec_deg": -33.3856,
        "radec_err_arcsec": 1.2,
        "det_like": 12.5,
        "flux_erg_s_cm2": 1.0e-13,
        "rate": 0.4,
        "exposure_s": 800.0,
        "ext_arcsec": 0.0,
        "ext_like": 0.0,
        "flag_sp_snr": False,
        "flag_sp_scl": False,
        "flag_sp_lga": False,
        "flag_sp_gc_cons": False,
        "redshift": None,
        "redshift_err": None,
        "ls10_type": "PSF",
        "class_gal_exgal": 5,
        "class_jetted": 0,
        "gdr3_g_mag": 20.1,
        "main_id_simbad": "",
        "morph_type_simbad": "",
    }
    record.update(overrides)
    return record


class ErositaDr2CatalogImportTest(unittest.TestCase):
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

    def test_pinned_sources_and_bands(self) -> None:
        importer = self.importer
        self.assertIn("erosita.mpe.mpg.de/dr2/", importer.MAIN_CATALOG_URL)
        self.assertTrue(importer.MAIN_CATALOG_URL.endswith("eRASS3_Main_v1.3.fits"))
        self.assertIn("eRASSc3_Main_LS10", importer.LS10_COUNTERPARTS_URL)
        self.assertLessEqual(importer.MIN_EXPECTED_MAIN_RECORDS, 1_975_540)
        self.assertGreaterEqual(importer.MAX_EXPECTED_MAIN_RECORDS, 1_975_540)
        self.assertLessEqual(importer.MIN_EXPECTED_COUNTERPART_RECORDS, 1_591_243)
        self.assertGreaterEqual(importer.MAX_EXPECTED_COUNTERPART_RECORDS, 1_591_243)
        # Ramos-Ceja et al. 2026: exactly 63,796 extended sources.
        self.assertLessEqual(importer.MIN_EXPECTED_EXTENDED_RECORDS, 63_796)
        self.assertGreaterEqual(importer.MAX_EXPECTED_EXTENDED_RECORDS, 63_796)

    def test_classify_point_and_extended(self) -> None:
        classify = self.importer.classify
        self.assertEqual(classify(0.0), ("erosita_dr2_xray", "erosita_dr2_main", "xray_source"))
        self.assertEqual(classify(None), ("erosita_dr2_xray", "erosita_dr2_main", "xray_source"))
        self.assertEqual(classify(0.5), ("erosita_dr2_extended", "erosita_dr2_extended", "xray_extended"))
        self.assertEqual(classify(12.0), ("erosita_dr2_extended", "erosita_dr2_extended", "xray_extended"))

    def test_spurious_flags_are_facts_not_types(self) -> None:
        row = self.build(base_record(ext_like=3.0, flag_sp_snr=True))
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["object_type"], "xray_extended")
        facts = json.loads(values["facts"])
        self.assertIn("flag_sp_snr", facts)
        self.assertIn("not a classification", facts["flag_sp_snr"])

    def test_row_without_redshift_uses_reference_shell(self) -> None:
        row = self.build(base_record())
        self.assertIsNotNone(row)
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["catalog_group"], "erosita_dr2_xray")
        self.assertEqual(values["object_type"], "xray_source")
        self.assertEqual(values["position_model"], "catalog_sky_position_reference_shell")
        self.assertAlmostEqual(values["distance_pc"], self.shared.REFERENCE_SHELL_PC)
        facts = json.loads(values["facts"])
        self.assertTrue(facts["distance_unknown"])
        self.assertEqual(facts["display_shell_ly"], 1.0e9)
        self.assertNotIn("redshift", facts)
        self.assertNotIn("cosmology", facts)

    def test_row_with_redshift_uses_comoving_distance(self) -> None:
        row = self.build(base_record(redshift=1.0, redshift_err=0.0005))
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["position_model"], "catalog_inferred_compiled_redshift_comoving")
        expected_pc = self.shared.comoving_distance_mpc(1.0) * 1.0e6
        self.assertAlmostEqual(values["distance_pc"], expected_pc, delta=expected_pc * 1e-6)
        facts = json.loads(values["facts"])
        self.assertEqual(facts["redshift"], 1.0)
        self.assertEqual(facts["redshift_kind"], "simbad_compiled")
        self.assertIn("not always reliable", facts["redshift_caveat"])
        self.assertNotIn("distance_unknown", facts)

    def test_unphysical_redshift_falls_back_to_shell(self) -> None:
        for bad in (-0.5, 0.0, float("nan"), 25.0):
            row = self.build(base_record(redshift=bad))
            values = dict(zip(self.shared.COPY_COLUMNS, row))
            self.assertEqual(values["position_model"], "catalog_sky_position_reference_shell", f"z={bad}")

    def test_search_text_and_identity(self) -> None:
        row = self.build(base_record())
        values = dict(zip(self.shared.COPY_COLUMNS, row))
        self.assertEqual(values["key"], "erosita-dr2-3erass-j000646-9m332308")
        self.assertEqual(values["name"], "3eRASS J000646.9-332308")
        self.assertEqual(values["catalog_object_key"], values["key"])
        self.assertEqual(values["source_identifier"], "sb03_002123_020_ML00005_001_c030")
        self.assertIn("3erass", values["search_text"])
        self.assertIn("x-ray", values["search_text"])
        self.assertIn("erosita", values["search_text"])
        external_ids = json.loads(values["external_ids"])
        self.assertEqual(external_ids["erosita_dr2_detuid"], "sb03_002123_020_ML00005_001_c030")

    def test_counterpart_codes_stay_numeric(self) -> None:
        row = self.build(base_record())
        facts = json.loads(dict(zip(self.shared.COPY_COLUMNS, row))["facts"])
        self.assertEqual(facts["class_gal_exgal_code"], 5)
        self.assertEqual(facts["class_jetted_code"], 0)

    def test_pseudo_magnitude_tracks_flux(self) -> None:
        bright = self.build(base_record(flux_erg_s_cm2=1.0e-12))
        faint = self.build(base_record(flux_erg_s_cm2=1.0e-14))
        columns = self.shared.COPY_COLUMNS
        bright_mag = dict(zip(columns, bright))["apparent_magnitude"]
        faint_mag = dict(zip(columns, faint))["apparent_magnitude"]
        self.assertLess(bright_mag, faint_mag)
        self.assertAlmostEqual(bright_mag, 8.0, places=6)
        # Must stay inside the SMP3-encodable magnitude band (below 23.3).
        self.assertLessEqual(faint_mag, 23.0)
        facts = json.loads(dict(zip(columns, bright))["facts"])
        self.assertEqual(facts["display_magnitude_kind"], "xray_flux_pseudo_magnitude")

    def test_extended_source_extent_requires_distance(self) -> None:
        with_z = self.build(base_record(ext_like=9.0, ext_arcsec=60.0, redshift=0.1))
        facts_with_z = json.loads(dict(zip(self.shared.COPY_COLUMNS, with_z))["facts"])
        self.assertIn("extent_ly", facts_with_z)
        self.assertGreater(facts_with_z["extent_ly"], 0.0)
        without_z = self.build(base_record(ext_like=9.0, ext_arcsec=60.0))
        facts_without_z = json.loads(dict(zip(self.shared.COPY_COLUMNS, without_z))["facts"])
        self.assertNotIn("extent_ly", facts_without_z)

    def test_key_preserves_declination_sign(self) -> None:
        # The catalog contains distinct sources that differ only by dec sign.
        plus = self.build(base_record(iauname="3eRASS J054951.9+212258"))
        minus = self.build(base_record(iauname="3eRASS J054951.9-212258"))
        columns = self.shared.COPY_COLUMNS
        self.assertNotEqual(dict(zip(columns, plus))["key"], dict(zip(columns, minus))["key"])

    def test_missing_identity_or_position_rejected(self) -> None:
        self.assertIsNone(self.build(base_record(iauname="")))
        self.assertIsNone(self.build(base_record(detuid="")))
        self.assertIsNone(self.build(base_record(ra_deg=None)))
        self.assertIsNone(self.build(base_record(dec_deg=95.0)))

    def test_comoving_distance_matches_desi_cosmology(self) -> None:
        shared = self.shared
        self.assertEqual(shared.H0_KM_S_MPC, 67.66)
        self.assertEqual(shared.OMEGA_M, 0.30966)
        # z=1 comoving distance for this cosmology is ~3.4 Gpc; monotonic in z.
        d1 = shared.comoving_distance_mpc(1.0)
        d2 = shared.comoving_distance_mpc(2.0)
        self.assertGreater(d1, 3000.0)
        self.assertLess(d1, 3700.0)
        self.assertGreater(d2, d1)
        self.assertEqual(shared.comoving_distance_mpc(0.0), 0.0)


if __name__ == "__main__":
    unittest.main()
