#!/usr/bin/env python3
"""Guardrails for the compact real extragalactic survey catalog."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_builder():
    module_path = ROOT / "scripts" / "build_curated_extragalactic_survey_catalog.py"
    spec = importlib.util.spec_from_file_location("build_curated_extragalactic_survey_catalog", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_curated_extragalactic_catalog_combines_nearby_survey_and_landmarks():
    builder = load_builder()
    catalog = builder.build_catalog()
    objects = catalog["objects"]

    assert catalog["source"]["primary_services"] == ["NASA HEASARC", "NASA/IPAC Extragalactic Database", "CDS SIMBAD"]
    assert "HEASARC NEARGALCAT" in catalog["source"]["survey_catalogs"]
    assert "Abell clusters" in catalog["source"]["survey_catalogs"]
    assert "offline" in catalog["selection"]["download_policy"]
    assert len(objects) >= 800

    classes = {obj["facts"]["survey_class"] for obj in objects}
    assert "satellite_galaxy" in classes
    assert "abell_galaxy_cluster" in classes
    assert "supercluster_landmark" in classes
    assert "luminous_quasar" in classes


def test_generated_extragalactic_snapshot_is_importable_shape():
    path = ROOT / "data" / "catalogs" / "curated_extragalactic_survey.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    objects = data["objects"]
    keys = [obj["key"] for obj in objects]

    assert data["object_count"] == len(objects)
    assert len(keys) == len(set(keys))
    assert {obj["catalog_group"] for obj in objects} == {"curated_extragalactic_survey"}
    assert {obj["source_type"] for obj in objects} == {"curated_extragalactic_survey"}

    for obj in objects:
        assert 0 <= obj["ra_deg"] < 360
        assert -90 <= obj["dec_deg"] <= 90
        assert obj["distance_ly"] > 0
        assert obj["object_type"] in {"galaxy", "quasar", "active_galaxy"}
        assert obj["facts"]["source_catalog"]
        assert obj["facts"]["source_urls"]


def test_backend_and_tiles_include_curated_extragalactic_group():
    importer = (ROOT / "backend_phoenix" / "lib" / "starsmap_api" / "catalog" / "importer.ex").read_text(encoding="utf-8")
    tiles = (ROOT / "scripts" / "build_static_point_tiles.py").read_text(encoding="utf-8")
    main = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")

    assert ":curated_extragalactic_survey" in importer
    assert "curated_extragalactic_survey.json" in importer
    assert "curated_extragalactic_survey" in tiles
    assert "curated_extragalactic_survey" in main


def test_heasarc_nearby_galaxy_snapshot_fills_local_volume():
    source = json.loads((ROOT / "data" / "sources" / "heasarc_neargalcat.json").read_text())
    catalog = json.loads((ROOT / "data" / "catalogs" / "curated_extragalactic_survey.json").read_text())
    nearby = [obj for obj in catalog["objects"] if obj.get("facts", {}).get("source_catalog") == "HEASARC NEARGALCAT"]

    assert source["object_count"] >= 800
    assert len(nearby) >= 800
    assert all(obj["object_type"] == "galaxy" for obj in nearby)
    assert all(obj["distance_ly"] > 0 for obj in nearby)
    assert all(obj["position_model"] == "heasarc_neargalcat_j2000_distance_coordinates" for obj in nearby)


def test_static_tile_builder_reads_the_partitioned_catalog_view():
    tiles = (ROOT / "scripts" / "build_static_point_tiles.py").read_text()
    assert "FROM catalog_source_objects" in tiles
    assert "FROM catalog_objects\n" not in tiles


if __name__ == "__main__":
    test_functions = [value for name, value in globals().copy().items() if name.startswith("test_") and callable(value)]
    result = unittest.TextTestRunner().run(unittest.TestSuite(unittest.FunctionTestCase(test) for test in test_functions))
    raise SystemExit(0 if result.wasSuccessful() else 1)
