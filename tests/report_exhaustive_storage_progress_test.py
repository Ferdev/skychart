from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.report_exhaustive_storage_progress import progress_table


def test_completed_psc_index_uses_measurement_when_final_progress_has_no_size():
    artifacts = {
        "complete_source": {"logical_bytes": None},
        "full_schema_detail": {"logical_bytes": None},
        "id_routing": {"logical_bytes": None},
    }
    ledger = {
        "catalogs": [{"id": "2mass-psc", "artifacts": artifacts}],
        "psc_full_run_progress": {
            "files": 92,
            "rows": 470_992_970,
            "measured_detail_bytes": 48_263_451_660,
        },
        "psc_completion_audit": {
            "source_bytes": 42_672_321_835,
            "candidate_data_bytes": 48_263_451_660,
            "rows": 470_992_970,
        },
        "psc_global_index_progress": {
            "status": "COMPLETE_COMPONENT",
            "committed_files": 92,
            "committed_rows": 470_992_970,
        },
        "psc_global_index_measurement": {
            "logical_bytes": 80_174_878_720,
            "files": 92,
            "rows": 470_992_970,
        },
    }

    table = progress_table(ledger)

    assert "80,174,878,720; all 92/92 files, 470,992,970 rows" in table


def test_completed_desi_angular_component_is_disclosed_separately():
    artifacts = {
        "complete_source": {"logical_bytes": 22_371_272_640, "status": "measured"},
        "full_schema_detail": {"logical_bytes": 10_533_500_019},
        "id_routing": {"logical_bytes": 2_743_621_202},
    }
    ledger = {
        "catalogs": [{"id": "desi-dr1", "artifacts": artifacts}],
        "desi_angular_measurement": {
            "logical_bytes": 2_557_296_640,
            "angular_rows": 28_425_963,
        },
    }

    table = progress_table(ledger)

    assert (
        "2,743,621,202 (combined component; see ledger); angular 2,557,296,640 "
        "(28,425,963 exact positions plus R-tree candidates)"
    ) in table


def test_simbad_live_counts_do_not_become_source_bytes():
    artifacts = {
        "complete_source": {"logical_bytes": None},
        "full_schema_detail": {"logical_bytes": None},
        "id_routing": {"logical_bytes": None},
    }
    ledger = {
        "catalogs": [{"id": "simbad-basic", "artifacts": artifacts}],
        "simbad_scope_metadata": {
            "provider_metadata_counts": {
                "basic_rows": 22_153_861,
                "identifier_rows": 72_905_435,
            },
        },
    }

    table = progress_table(ledger)

    assert (
        "Unknown; provider reports 22,153,861 basic and 72,905,435 identifier rows "
        "in a mutable live database"
    ) in table


def test_legacy_provider_estimate_remains_separate_from_probe_bytes():
    artifacts = {
        "complete_source": {"logical_bytes": None},
        "full_schema_detail": {"logical_bytes": None},
        "id_routing": {"logical_bytes": None},
    }
    ledger = {
        "catalogs": [{"id": "legacy-surveys", "artifacts": artifacts}],
        "legacy_tractor_full_probe_receipt": {
            "source_bytes": 22_213_440,
            "detail_bytes": 13_975_470,
        },
        "legacy_dr10_provider_estimates": {
            "provider_estimates": {"tractor_directory": "6.6 TB"},
        },
    }

    table = progress_table(ledger)

    assert "22,213,440 for 1/366912 Tractor files; provider estimate 6.6 TB" in table
    assert "13,975,470 (one-file full-field probe)" in table
    assert table.endswith(
        "Build projections are temporary inputs, not serving indexes. Runtime estimates and observed scratch peaks remain in the ledger.\n"
    )


def test_panstarrs_provider_database_size_is_not_a_source_measurement():
    artifacts = {
        "complete_source": {"logical_bytes": None},
        "full_schema_detail": {"logical_bytes": None},
        "id_routing": {"logical_bytes": None},
    }
    ledger = {
        "catalogs": [{"id": "panstarrs", "artifacts": artifacts}],
        "ps1_current_access": {"provider_catalog_database_size": "nearly 150 TB"},
    }

    table = progress_table(ledger)

    assert "Unknown; provider reports nearly 150 TB for the catalog database" in table
    assert "| Unknown | Unbuilt/unmeasured | Unknown |" in table


def test_allwise_companion_provider_sizes_do_not_become_owned_measurements():
    artifacts = {
        "complete_source": {"logical_bytes": None},
        "full_schema_detail": {"logical_bytes": None},
        "id_routing": {"logical_bytes": None},
    }
    ledger = {
        "catalogs": [
            {"id": "allwise-mep", "artifacts": artifacts},
            {"id": "allwise-images", "artifacts": artifacts},
        ],
        "allwise_mep_provider_inventory": {
            "provider_manifest_compressed_bytes": 3_419_775_536_324,
            "provider_reported_uncompressed_bytes": 16_948_242_777_472,
            "parts": 792,
        },
        "allwise_images_s3_progress": {
            "coadd_ids": 19,
            "objects": 1_000,
            "bytes": 13_243_677_386,
        },
    }

    table = progress_table(ledger)

    assert "Unknown; provider manifests 3,419,775,536,324 compressed bytes in 792 parts" in table
    assert "Unknown; provider S3 inventory 19/18,240 image sets, 1,000 objects" in table
    assert table.count("| Unknown | Unbuilt/unmeasured | Unknown |") == 2
