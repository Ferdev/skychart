#!/usr/bin/env python3
"""Guardrails for the recognized dwarf-planet subset of the static catalog."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_builder():
    path = ROOT / "scripts" / "build_small_body_catalog.py"
    spec = importlib.util.spec_from_file_location("build_small_body_catalog", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class SmallBodyDwarfPlanetCatalogTests(unittest.TestCase):
    def test_static_dwarf_planets_are_an_explicit_selection_slice(self):
        builder = load_builder()
        adapter = next(item for item in builder.SOURCE_ADAPTERS if item["name"] == "iau_recognized_dwarf_planets")

        self.assertEqual(set(builder.STATIC_RECOGNIZED_DWARF_PLANETS), {"1", "136108", "136472", "136199"})
        self.assertNotIn("pluto", {name.lower() for name in builder.STATIC_RECOGNIZED_DWARF_PLANETS.values()})
        for designation in builder.STATIC_RECOGNIZED_DWARF_PLANETS:
            self.assertIn(f"pdes|EQ|{designation}", adapter["params"]["sb-cdata"])

    def test_recognized_dwarf_classification_is_separate_from_jpl_provenance(self):
        builder = load_builder()
        row = {"pdes": "1", "_source_family": "asteroid"}

        self.assertEqual(builder.object_type_for(row), "dwarf_planet")
        classification = builder.classification_metadata(row, "dwarf_planet")["classification"]
        self.assertEqual(classification["authority"], "International Astronomical Union")
        self.assertEqual(classification["status"], "recognized")
        self.assertIn("iau.org", classification["recognition_url"])

        candidate = {"pdes": "225088", "name": "Gonggong", "_source_family": "asteroid"}
        self.assertEqual(builder.object_type_for(candidate), "asteroid")
        self.assertEqual(builder.classification_metadata(candidate, "asteroid"), {})
        self.assertIsNone(builder.estimated_diameter_km({"H": -1.26}, "dwarf_planet"))

    def test_validator_requires_exactly_four_unique_static_dwarfs(self):
        builder = load_builder()
        objects = [
            {"object_type": "dwarf_planet", "external_ids": {"primary_designation": designation}}
            for designation in builder.STATIC_RECOGNIZED_DWARF_PLANETS
        ]
        builder.validate_static_recognized_dwarfs(objects)

        with self.assertRaisesRegex(ValueError, "exactly the four"):
            builder.validate_static_recognized_dwarfs(objects[:-1])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            builder.validate_static_recognized_dwarfs(objects + [objects[0]])

    def test_generated_catalog_contains_exactly_four_recognized_static_dwarfs(self):
        payload = json.loads((ROOT / "data" / "catalogs" / "small_bodies.json").read_text())
        dwarfs = [item for item in payload["objects"] if item["object_type"] == "dwarf_planet"]

        self.assertEqual(
            {item["external_ids"]["primary_designation"] for item in dwarfs},
            {"1", "136108", "136472", "136199"},
        )
        self.assertEqual(len(dwarfs), 4)
        self.assertEqual(payload["schema_version"], 2)
        self.assertEqual(payload["snapshot_lineage"]["assembly_mode"], "base_snapshot_plus_explicit_slice")
        self.assertEqual(payload["generated_at_utc"], payload["snapshot_lineage"]["assembled_at_utc"])
        self.assertTrue(all(item["classification"]["authority"] == "International Astronomical Union" for item in dwarfs))
        self.assertTrue(all(item["source_type"] == "jpl_sbdb_query" for item in dwarfs))


if __name__ == "__main__":
    unittest.main()
