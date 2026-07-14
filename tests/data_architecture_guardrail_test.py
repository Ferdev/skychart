"""Guardrails for catalog data-architecture groundwork."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_CONTEXT = (ROOT / "backend_phoenix/lib/starsmap_api/catalog.ex").read_text()
SOURCE_MIGRATION = (
    ROOT / "backend_phoenix/priv/repo/migrations/20260515000000_create_source_specific_catalog_tables.exs"
).read_text()


def load_script(name: str):
    module_path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DataArchitectureGuardrailTest(unittest.TestCase):
    def test_runtime_catalog_queries_use_source_specific_union_not_legacy_catalog_objects(self) -> None:
        self.assertIn("CREATE VIEW catalog_source_objects", SOURCE_MIGRATION)
        self.assertIn("CatalogSourceObject", CATALOG_CONTEXT)
        self.assertIn("catalog_source_objects", CATALOG_CONTEXT)
        self.assertNotIn("CatalogObject", CATALOG_CONTEXT)
        self.assertNotIn("FROM catalog_objects", CATALOG_CONTEXT)
        self.assertNotIn("Repo.insert_all(CatalogObject", CATALOG_CONTEXT)

    def test_small_body_builder_uses_explicit_source_adapters_for_asteroids_comets_and_satellites(self) -> None:
        builder = load_script("build_small_body_catalog")

        adapters = builder.SOURCE_ADAPTERS
        self.assertEqual(
            {adapter["family"] for adapter in adapters},
            {"asteroid", "comet", "satellite"},
        )
        self.assertTrue(all(adapter["name"] and adapter["params"] for adapter in adapters))

        satellite = builder.build_object(
            {
                "spkid": "599",
                "full_name": "Jupiter IX",
                "name": "Sinope",
                "kind": "s",
                "epoch": "2460000.5",
                "e": "0.25",
                "a": "0.16",
                "i": "158.0",
                "om": "10.0",
                "w": "20.0",
                "ma": "30.0",
                "n": "0.1",
                "_selection": ["small_body_satellites"],
                "_source_adapters": ["small_body_satellites"],
                "_source_family": "satellite",
            },
            2460000.5,
        )

        assert satellite is not None
        self.assertEqual(satellite["object_type"], "satellite")
        self.assertEqual(satellite["source_type"], "jpl_sb_sat")
        self.assertIn("small_body_satellites", satellite["facts"]["source_adapters"])
        self.assertEqual(satellite["facts"]["source_family"], "satellite")

    def test_gaia_bulk_copy_rows_propagate_positions_to_target_epoch(self) -> None:
        importer = load_script("import_gaia_bulk_catalog")

        ra, dec, note, epoch = importer.propagated_catalog_position(
            10.0,
            -20.0,
            100.0,
            -50.0,
            2026.0,
        )

        self.assertEqual(epoch, 2026.0)
        self.assertIn("propagated", note)
        self.assertNotEqual(ra, 10.0)
        self.assertNotEqual(dec, -20.0)

    def test_bright_star_builder_keeps_epoch_metadata_when_proper_motion_is_missing(self) -> None:
        builder = load_script("build_bright_star_catalog")

        ra, dec, note, epoch = builder.propagated_catalog_position(10.0, -20.0, None, None)

        self.assertEqual((ra, dec), (10.0, -20.0))
        self.assertEqual(epoch, builder.HIPPARCOS_EPOCH)
        self.assertIn("No complete proper-motion", note)


if __name__ == "__main__":
    unittest.main()
