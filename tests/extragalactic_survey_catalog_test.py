#!/usr/bin/env python3
"""Guardrails for the compact real extragalactic survey catalog."""

from __future__ import annotations

import importlib.util
import json
import sys
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


def test_curated_extragalactic_catalog_is_small_real_survey_snapshot():
    builder = load_builder()
    catalog = builder.build_catalog()
    objects = catalog["objects"]

    assert catalog["source"]["primary_services"] == ["NASA/IPAC Extragalactic Database", "CDS SIMBAD"]
    assert "Abell clusters" in catalog["source"]["survey_catalogs"]
    assert catalog["selection"]["download_policy"].startswith("No bulk survey download")
    assert 20 <= len(objects) <= 100

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
