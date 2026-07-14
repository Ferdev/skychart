import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).parents[1]
REGISTRY = json.loads((ROOT / "backend_phoenix/priv/science_semantics.json").read_text())
MAIN = (ROOT / "src/main.ts").read_text()


class ScientificTrustGuardrails(unittest.TestCase):
    def test_representative_sources_have_explicit_semantics(self):
        fixtures = {
            "gaia_star": ("gaia_dr3_epoch_2026_00_proper_motion_coordinates", "geometric_parallax"),
            "nearby_galaxy": ("heasarc_neargalcat_j2000_distance_coordinates", "literature_distance"),
            "desi_galaxy": ("catalog_redshift_comoving", "redshift_comoving"),
            "quaia_quasar": ("catalog_inferred_redshift_comoving", "inferred_redshift_comoving"),
        }
        for fixture, (model, kind) in fixtures.items():
            with self.subTest(fixture=fixture):
                semantics = REGISTRY["position_models"][model]
                self.assertEqual(kind, semantics["distance_kind"])
                self.assertTrue(semantics["coordinate_frame"])
                self.assertTrue(semantics["projection"])
                self.assertTrue(semantics["catalog_epoch"])
                self.assertTrue(semantics["position_epoch"])
                self.assertTrue(semantics["source"]["url"])
                self.assertTrue(semantics["selection_caveat"])

    def test_universe_panel_does_not_derive_precision_from_distance(self):
        panel = MAIN.split("function renderUniverseSciencePanel", 1)[1].split("function objectSummaryText", 1)[0]
        self.assertNotIn("formatLookbackTime(distanceLy)", panel)
        self.assertNotIn("formatRedshiftEstimate(distanceLy)", panel)
        self.assertIn("measuredRedshift(record)", panel)

    def test_unknown_uncertainty_is_explicit_and_no_error_bar_is_invented(self):
        semantics = (ROOT / "src/scienceSemantics.ts").read_text()
        self.assertIn("Uncertainty not supplied by this atlas source.", semantics)
        self.assertNotIn("Math.sqrt", semantics)


if __name__ == "__main__":
    unittest.main()
