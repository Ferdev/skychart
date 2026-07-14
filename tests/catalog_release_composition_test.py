#!/usr/bin/env python3
"""Guardrails for scientific provenance and immutable layer composition."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name: str):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_quaia_metadata_never_claims_spectroscopic_distance():
    quaia = load("quaia_bulk_pipeline")
    metadata = quaia.release_metadata(755_000, 850)

    assert metadata["source"]["license"] == "CC BY 4.0"
    assert metadata["source"]["doi"] == "10.5281/zenodo.10403370"
    assert metadata["selection"]["distance_quality"] == "inferred_spectrophotometric_ml_redshift"
    assert "Not a spectroscopic distance" in metadata["selection"]["distance_warning"]
    assert metadata["deduplication"]["priority"][0] == "desi_dr1_spectroscopic"


def test_generic_composer_preserves_base_counts_and_provenance():
    composer = load("compose_catalog_layer_release")
    base = {
        "version": "v8",
        "source_counts": {"desi_dr1_galaxies": 14_000_000},
        "layers": [{"id": "desi_dr1", "container": "desi.smpk"}],
    }
    addition = {
        "source": {"doi": "10.5281/zenodo.10403370", "license": "CC BY 4.0"},
        "selection": {"distance_quality": "inferred_spectrophotometric_ml_redshift"},
        "source_counts": {"quaia_g20_quasars": 755_000},
        "layers": [{"id": "quaia_g20", "container": "quaia_g20.smpk"}],
    }

    result = composer.compose(base, addition, "https://catalog.example/v9", "v9")

    assert result["source_counts"] == {
        "desi_dr1_galaxies": 14_000_000,
        "quaia_g20_quasars": 755_000,
    }
    assert result["layers"][1]["container"] == "https://catalog.example/v9/quaia_g20.smpk"
    assert result["catalog_sources"]["quaia_g20"]["source"]["license"] == "CC BY 4.0"


def test_generic_composer_refuses_silent_layer_replacement():
    composer = load("compose_catalog_layer_release")
    base = {"layers": [{"id": "desi_dr1", "container": "old.smpk"}]}
    addition = {
        "source_counts": {"desi_dr1_galaxies": 1},
        "layers": [{"id": "desi_dr1", "container": "new.smpk"}],
    }

    try:
        composer.compose(base, addition, "https://catalog.example/v9", "v9")
    except ValueError as error:
        assert "already contains layer" in str(error)
    else:
        raise AssertionError("composer silently replaced an immutable layer")


def test_tiny_quaia_partition_encodes_as_its_own_immutable_layer(tmp_path):
    try:
        import duckdb
    except ImportError:
        import pytest
        pytest.skip("offline bulk-build dependency duckdb is not installed")

    pipeline = load("desi_bulk_pipeline")
    quaia = load("quaia_bulk_pipeline")
    projected = tmp_path / "quaia.parquet"
    partitions = tmp_path / "partitioned"
    artifact = tmp_path / "artifact"
    connection = duckdb.connect()
    connection.execute(f"""
        COPY (
          SELECT 42::UBIGINT target_id, 1e15::DOUBLE x_au,
            2e15::DOUBLE y_au, 3e15::DOUBLE z_au,
            19.0::FLOAT magnitude, 3::UTINYINT type_code,
            244::UTINYINT color_idx
        ) TO '{projected}' (FORMAT PARQUET)
    """)
    metadata = quaia.release_metadata(1, 0)
    metadata["deduplication"].update({"removed_as_desi_matches": 0, "output_count": 1})
    projected.with_suffix(".json").write_text(json.dumps(metadata))

    assert pipeline.partition(connection, projected, partitions) == 0
    assert pipeline.encode(connection, partitions, artifact, "quaia-test-v1") == 0

    manifest = json.loads((artifact / "manifest.json").read_text())
    layer = manifest["layers"][0]
    assert layer["id"] == "quaia_g20"
    assert layer["groups"] == ["quaia_g20_quasars"]
    assert layer["container"] == "quaia_g20.smpk"
    assert (artifact / "quaia_g20.smpk").is_file()
    assert manifest["source_counts"] == {"quaia_g20_quasars": 1}
    assert manifest["source"]["doi"] == quaia.SOURCE_DOI
    assert manifest["selection"]["distance_quality"] == "inferred_spectrophotometric_ml_redshift"
    assert manifest["deduplication"]["output_count"] == 1
