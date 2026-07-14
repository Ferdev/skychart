#!/usr/bin/env python3
"""Deterministic guardrails for DESI Universe-level density sampling."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_pipeline():
    module_path = ROOT / "scripts" / "desi_bulk_pipeline.py"
    spec = importlib.util.spec_from_file_location("desi_bulk_pipeline", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_coarse_levels_target_a_visibly_populated_real_sample():
    pipeline = load_pipeline()
    coarse = {level: (cap, target) for level, cap, target in pipeline.LEVELS if level >= 48}

    assert set(coarse) == {48, 50, 52, 54}
    for cap, target in coarse.values():
        assert target is not None
        assert target >= 1_000_000
        assert cap >= 500_000


def test_v8_distribution_would_put_at_least_500k_in_reference_universe_view():
    pipeline = load_pipeline()
    source_count = 14_556_453
    reference_view_raw_count = 5_915_155
    raw_max = 5_390_254
    cap = 800_000
    target = 1_500_000

    buckets = pipeline.sample_buckets_for_level(
        source_count=source_count,
        raw_max=raw_max,
        cap=cap,
        target_points=target,
    )
    expected_global = source_count * buckets / pipeline.HASH_BUCKET_COUNT
    expected_in_reference_view = reference_view_raw_count * buckets / pipeline.HASH_BUCKET_COUNT
    expected_dense_tile = raw_max * buckets / pipeline.HASH_BUCKET_COUNT

    assert 1_490_000 <= expected_global <= 1_500_000
    assert 600_000 <= expected_in_reference_view <= 1_000_000
    assert expected_dense_tile < cap * pipeline.DENSITY_SAMPLE_HEADROOM


def test_sampling_fraction_is_global_and_deterministic():
    pipeline = load_pipeline()
    kwargs = {
        "source_count": 14_556_453,
        "raw_max": 5_390_254,
        "cap": 800_000,
        "target_points": 1_500_000,
    }

    first = pipeline.sample_buckets_for_level(**kwargs)
    second = pipeline.sample_buckets_for_level(**kwargs)

    assert first == second
    assert 0 < first <= pipeline.HASH_BUCKET_COUNT


def test_detailed_level_remains_density_limited():
    pipeline = load_pipeline()
    buckets = pipeline.sample_buckets_for_level(
        source_count=14_556_453,
        raw_max=481_613,
        cap=30_000,
        target_points=None,
    )

    expected = int(
        pipeline.HASH_BUCKET_COUNT
        * pipeline.DENSITY_SAMPLE_HEADROOM
        * 30_000
        / 481_613
    )
    assert buckets == expected
