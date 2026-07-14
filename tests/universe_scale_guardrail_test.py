#!/usr/bin/env python3
"""Guardrails for continuous physical points and real universe rendering."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "src" / "main.ts").read_text()
INDEX = (ROOT / "index.html").read_text()
PLANNER = (ROOT / "src" / "catalog" / "catalogPointPlanner.ts").read_text()
SELECTOR = (ROOT / "src" / "catalog" / "catalogPointSelector.ts").read_text()
VISIBILITY = (ROOT / "src" / "rendering" / "atlasVisibilityModel.ts").read_text()
DEFINITIONS = (ROOT / "src" / "atlas" / "atlasDefinitions.ts").read_text()
DOM = (ROOT / "src" / "atlas" / "atlasDom.ts").read_text()


class UniverseScaleGuardrailTest(unittest.TestCase):
    def test_catalog_points_have_no_minimum_physical_view_width(self) -> None:
        self.assertNotIn("POINT_LAYER_MIN_WIDTH_LY", PLANNER)
        body = PLANNER[PLANNER.index("function shouldUseCatalogPoints") : PLANNER.index("function layerCoversAnyType")]
        self.assertIn("viewWidthLy <= 0", body)
        self.assertIsNone(re.search(r"viewWidthLy\s*<\s*[A-Z0-9_]+", body))

    def test_procedural_universe_artwork_is_not_rendered(self) -> None:
        for renderer in [
            "drawLocalGroupLayer",
            "drawGalaxyContextLayer",
            "drawQuasarContextLayer",
            "drawCosmicWebLayer",
            "drawCatalogDensityLodLayer",
        ]:
            self.assertNotIn(renderer, MAIN)
        self.assertNotIn("universeModel", MAIN)
        self.assertFalse((ROOT / "src" / "universeModel.ts").exists())

    def test_procedural_universe_controls_are_removed(self) -> None:
        for layer in ["localGroup", "galaxyPoints", "quasars", "cosmicWeb"]:
            self.assertNotIn(f'data-layer="{layer}"', INDEX)

    def test_universe_preset_targets_real_catalog_scale(self) -> None:
        self.assertIn('<small>4B ly</small>', INDEX)
        preset_body = MAIN[MAIN.index("function applyZoomPreset") : MAIN.index("function presetBodies")]
        self.assertIn('fitPhysicalScale(4_000_000_000, 0.10)', preset_body)
        self.assertNotIn("COSMIC_WEB_MODEL", preset_body)

    def test_catalog_point_layers_reach_cosmological_scale(self) -> None:
        self.assertIn("POINT_LAYER_DEEP_SKY_MAX_WIDTH_LY", PLANNER)
        self.assertIn("POINT_LAYER_QUASAR_MAX_WIDTH_LY", PLANNER)
        self.assertIn("MAX_ACTIVE_UNIVERSE", PLANNER)
        self.assertIn("MAX_POINTS_UNIVERSE", PLANNER)

    def test_desi_pipeline_uses_real_catalog_ids_and_type_codes(self) -> None:
        pipeline = (ROOT / "scripts" / "desi_bulk_pipeline.py").read_text()
        self.assertIn("ZCAT_PRIMARY", pipeline)
        self.assertIn("ZWARN", pipeline)
        self.assertIn('survey == "main"', pipeline)
        self.assertIn("MIN_REDSHIFT = 0.0001", pipeline)
        self.assertIn("SOURCE_SHA256", pipeline)
        self.assertIn('TYPE_CODES = {"GALAXY": 1, "QSO": 3}', pipeline)
        self.assertIn("target_id", pipeline)
        self.assertIn("line-of-sight comoving distance", pipeline)
        self.assertNotIn("(40,", pipeline)
        self.assertNotIn("(42,", pipeline)
        self.assertIn("(44,", pipeline)

    def test_desi_groups_are_available_in_deep_sky_filters(self) -> None:
        sources = PLANNER + SELECTOR + DEFINITIONS
        self.assertGreaterEqual(sources.count('"desi_dr1_galaxies"'), 3)
        self.assertGreaterEqual(sources.count('"desi_dr1_quasars"'), 3)
        self.assertIn("hydrateDesi", SELECTOR)
        self.assertIn("desi_targetid", SELECTOR)

    def test_static_tile_builder_has_universe_scale_levels(self) -> None:
        builder = (ROOT / "scripts" / "build_static_point_tiles.py").read_text()
        self.assertIn("42:128:12000", builder)
        self.assertIn("44:64:12000", builder)
        for level in ["46:48:9000", "48:24:7500", "50:12:6000"]:
            self.assertIn(level, builder)

    def test_webgl_renderer_caps_points_per_frame(self) -> None:
        renderer = (ROOT / "src" / "webglPointRenderer.ts").read_text()
        self.assertIn("MAX_WEBGL_POINTS_PER_FRAME", renderer)
        self.assertIn("drawCount", renderer)

    def test_smp3_load_prefix_is_stable_and_hit_testing_is_dense(self) -> None:
        request_body = PLANNER[PLANNER.index("private requestsForLevel") : PLANNER.index("private prioritizedLayers")]
        hit_body = VISIBILITY[VISIBILITY.index("private rebuildPointGrid") : VISIBILITY.index("private isMajorBody")]
        self.assertNotIn("adaptiveCatalogPointBudget", PLANNER)
        self.assertIn("? configuredLimit", request_body)
        self.assertNotIn("payload.returned / 2_500", hit_body)
        self.assertIn("POINT_GRID_CELL_PX", hit_body)
        self.assertIn('requiredElement<HTMLElement>("#catalog-point-hover")', DOM)


if __name__ == "__main__":
    unittest.main()
