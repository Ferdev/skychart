#!/usr/bin/env python3
"""Guardrails for static catalog tile defaults and shared artifact workflow."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_tile_builder():
    module_path = ROOT / "scripts" / "build_static_point_tiles.py"
    spec = importlib.util.spec_from_file_location("build_static_point_tiles", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class StaticTileDefaultsTest(unittest.TestCase):
    def test_default_levels_reach_full_sample_density_at_close_zoom(self) -> None:
        builder = load_tile_builder()

        levels = builder.parse_levels(",".join(builder.DEFAULT_LEVELS))
        sample_by_span = {level.span_log2: level.sample_buckets for level in levels}

        self.assertGreaterEqual(sample_by_span[24], 128)
        self.assertGreaterEqual(sample_by_span[26], 512)
        self.assertEqual(sample_by_span[28], builder.POINT_SAMPLE_BUCKET_COUNT)
        self.assertEqual(sample_by_span[30], builder.POINT_SAMPLE_BUCKET_COUNT)
        self.assertEqual(sample_by_span[32], builder.POINT_SAMPLE_BUCKET_COUNT)
        self.assertEqual(sample_by_span[34], builder.POINT_SAMPLE_BUCKET_COUNT)

    def test_default_layers_do_not_duplicate_heavy_gaia_rows(self) -> None:
        builder = load_tile_builder()

        layers = builder.parse_layers(",".join(builder.DEFAULT_LAYERS))
        gaia_groups = set(builder.DEFAULT_GROUPS)
        heavy_layers = [layer for layer in layers if gaia_groups.intersection(layer.groups)]

        self.assertEqual([layer.id for layer in heavy_layers], ["gaia_stars"])
        self.assertEqual(set(heavy_layers[0].groups), gaia_groups)

    def test_catalog_tile_workflow_supports_staging_and_production_shared_artifacts(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "catalog-tiles.yml").read_text(encoding="utf-8")

        self.assertIn("target_environment", workflow)
        self.assertIn("staging", workflow)
        self.assertIn("production", workflow)
        self.assertIn("CATALOG_TILE_VERSION", workflow)
        self.assertIn("CATALOG_TILE_S3_PREFIX", workflow)
        self.assertIn("kamal app exec -d \"$TARGET_ENVIRONMENT\"", workflow)

    def test_catalog_import_runs_after_deploy_not_before_healthcheck(self) -> None:
        entrypoint = (ROOT / "scripts" / "docker-entrypoint.sh").read_text(encoding="utf-8")
        post_deploy = (ROOT / ".kamal" / "hooks" / "post-deploy").read_text(encoding="utf-8")

        self.assertNotIn("import_catalogs_if_needed.sh", entrypoint)
        self.assertIn("import_catalogs_if_needed.sh", post_deploy)


if __name__ == "__main__":
    unittest.main()
