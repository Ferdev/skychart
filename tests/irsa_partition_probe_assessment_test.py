import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assess_irsa_partition_probe import assess


def fixtures():
    probe = {
        "source_file": "part01.bz2", "rows": 100,
        "source_bytes": 10, "uncompressed_bytes": 50,
        "detail_bytes": 20, "build_projection": {"bytes": 5},
        "peak_rss_kib": 100, "seconds": 8,
        "wall_seconds_including_download": 10,
        "all_fields_verified": True, "full_bzip_crc_verified": True,
    }
    inventory = {
        "parts": 2, "provider_manifest_compressed_bytes": 20,
        "provider_reported_uncompressed_bytes": 100,
        "readme_provider_reported_uncompressed_bytes": 110,
    }
    return probe, inventory


def test_separates_measured_probe_from_linear_projection_and_unknowns():
    probe, inventory = fixtures()
    result = assess(probe, inventory, free_bytes=1_000, free_floor_bytes=100, memory_limit_bytes=1_000_000)
    assert result["status"] == "SAFE_TO_CONTINUE_SEQUENTIAL_MEASUREMENT"
    assert result["measured_facts"]["probe_peak_coexisting_workspace_bytes"] == 35
    assert len(result["single_partition_linear_projection"]["hours_by_provider_uncompressed_claim"]) == 2
    assert result["single_partition_linear_projection"]["is_measured_full_duration"] is False
    assert result["unknowns"]


def test_blocks_when_disk_floor_or_memory_limit_would_be_crossed():
    probe, inventory = fixtures()
    assert assess(probe, inventory, free_bytes=120, free_floor_bytes=100,
                  memory_limit_bytes=1_000_000)["status"].startswith("INSUFFICIENT")
    assert assess(probe, inventory, free_bytes=1_000, free_floor_bytes=100,
                  memory_limit_bytes=10)["status"].startswith("INSUFFICIENT")
