#!/usr/bin/env python3
"""Regression coverage for carrying bulk tiles into curated catalog releases."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def load_composer():
    path = ROOT / "scripts" / "compose_bulk_catalog_release.py"
    spec = importlib.util.spec_from_file_location("compose_bulk_catalog_release", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def layer(layer_id: str, count: int, group: str | None = None):
    return {
        "id": layer_id,
        "container": f"https://catalog.example/immutable/{layer_id}.smpk",
        "groups": [group or layer_id],
        "types": ["star"] if layer_id == "gaia_stars" else ["galaxy"],
        "source_counts": {group or layer_id: count},
        "levels": [{"span_log2": 20, "span_au": 2**20, "point_count": count}],
    }


def manifests():
    base = {
        "version": "v12",
        "format": "SMP3",
        "layers": [
            layer("gaia_stars", 33_170, "gaia_local_stars"),
            layer("dwarf_planets", 4),
            layer("black_holes", 806),
        ],
    }
    carry = {
        "version": "v10",
        "gaia_tier": "T2",
        "parallax_over_error_min": 5.0,
        "source_counts": {"gaia_dr3_bulk": 192_208_856},
        "catalog_sources": {"quaia_g20": {"source": {"license": "CC BY 4.0"}}},
        "layers": [
            layer("gaia_stars", 192_208_856, "gaia_dr3_bulk"),
            layer("desi_dr1", 14_556_453, "desi_dr1_galaxies"),
            layer("quaia_g20", 575_010, "quaia_g20_quasars"),
        ],
    }
    return base, carry


def test_composition_replaces_thin_gaia_and_preserves_curated_layers():
    composer = load_composer()
    base, carry = manifests()

    result = composer.compose(base, carry, "v13")

    assert result["version"] == "v13"
    assert [item["id"] for item in result["layers"]] == [
        "gaia_stars",
        "desi_dr1",
        "dwarf_planets",
        "black_holes",
        "quaia_g20",
    ]
    assert result["layers"][0]["source_counts"] == {"gaia_dr3_bulk": 192_208_856}
    assert result["layers"][2]["source_counts"] == {"dwarf_planets": 4}
    assert result["layers"][3]["source_counts"] == {"black_holes": 806}
    assert result["gaia_tier"] == "T2"
    assert result["catalog_sources"] == carry["catalog_sources"]


@pytest.mark.parametrize(
    ("layer_id", "count"),
    [
        ("gaia_stars", 189_999_999),
        ("desi_dr1", 13_999_999),
        ("quaia_g20", 499_999),
    ],
)
def test_composition_refuses_truncated_bulk_layers(layer_id, count):
    composer = load_composer()
    base, carry = manifests()
    target = next(item for item in carry["layers"] if item["id"] == layer_id)
    target["source_counts"] = {"truncated": count}

    with pytest.raises(ValueError, match="expected at least"):
        composer.compose(base, carry, "v13")


def test_composition_refuses_missing_bulk_layer():
    composer = load_composer()
    base, carry = manifests()
    carry["layers"] = [item for item in carry["layers"] if item["id"] != "desi_dr1"]

    with pytest.raises(ValueError, match="missing required bulk layer 'desi_dr1'"):
        composer.compose(base, carry, "v13")
