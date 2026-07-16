#!/usr/bin/env python3
"""Guardrails for static catalog tile defaults and shared artifact workflow."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import tempfile
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
    def test_effective_levels_preserve_density_before_any_tile_cap(self) -> None:
        builder = load_tile_builder()
        levels = [builder.TileLevel(24, 1024, 65_000), builder.TileLevel(28, 1024, 24_000)]
        counts = {
            builder.TileKey(24, 0, 0): 40_000,
            builder.TileKey(24, 1, 0): 20_000,
            builder.TileKey(28, 0, 0): 960_000,
            builder.TileKey(28, 1, 0): 96_000,
        }

        effective = builder.density_preserving_levels(levels, counts)

        self.assertEqual(effective[0].sample_buckets, 1024)
        self.assertLess(effective[1].sample_buckets, 1024)
        expected_dense = 960_000 * effective[1].sample_buckets / builder.POINT_SAMPLE_BUCKET_COUNT
        expected_sparse = 96_000 * effective[1].sample_buckets / builder.POINT_SAMPLE_BUCKET_COUNT
        self.assertLess(expected_dense, effective[1].max_points_per_tile)
        self.assertAlmostEqual(expected_dense / expected_sparse, 10, places=6)

    def test_effective_level_keeps_every_point_when_raw_tiles_fit_the_cap(self) -> None:
        builder = load_tile_builder()
        level = builder.TileLevel(24, 1024, 65_000)

        effective = builder.density_preserving_levels(
            [level],
            {builder.TileKey(24, 0, 0): 53_301, builder.TileKey(24, 1, 0): 18_000},
        )

        self.assertEqual(effective[0].sample_buckets, builder.POINT_SAMPLE_BUCKET_COUNT)

    def test_sparse_object_type_layers_are_not_sampled_out_at_universe_scale(self) -> None:
        builder = load_tile_builder()
        level = builder.TileLevel(50, 12, 6_000)

        effective = builder.density_preserving_levels(
            [level],
            {builder.TileKey(50, 0, 0): 16},
        )

        self.assertEqual(effective[0].sample_buckets, builder.POINT_SAMPLE_BUCKET_COUNT)

    def test_globally_large_layers_keep_configured_lod_when_each_tile_is_sparse(self) -> None:
        builder = load_tile_builder()
        level = builder.TileLevel(50, 12, 6_000)
        counts = {builder.TileKey(50, index, 0): 100 for index in range(100)}

        effective = builder.density_preserving_levels([level], counts)

        self.assertEqual(effective[0].sample_buckets, 12)

    def test_default_levels_reach_full_sample_density_at_close_zoom(self) -> None:
        builder = load_tile_builder()

        levels = builder.parse_levels(",".join(builder.DEFAULT_LEVELS))
        sample_by_span = {level.span_log2: level.sample_buckets for level in levels}
        full = builder.POINT_SAMPLE_BUCKET_COUNT

        # Fine spans serve the closest zooms -- the solar neighborhood, where
        # true density is low and every catalog point matters. They must keep
        # every point, not the inverted heavy-sampling ramp that dropped all
        # but ~6% of stars at the closest zooms.
        self.assertEqual(sample_by_span[24], full)
        self.assertEqual(sample_by_span[26], full)
        self.assertEqual(sample_by_span[28], full)
        self.assertEqual(sample_by_span[30], full)
        self.assertEqual(sample_by_span[32], full)
        self.assertEqual(sample_by_span[34], full)

        # Guardrail against the one-file-per-tile explosion: spans finer than
        # 2^24 turn a few million points into hundreds of thousands of tiny
        # tile files and exhaust build disk before upload.
        self.assertNotIn(20, sample_by_span)
        self.assertNotIn(22, sample_by_span)

        # The finest level must instead absorb the dense solar-neighborhood
        # tiles with a raised per-tile cap so nothing is truncated up close.
        finest = min(levels, key=lambda level: level.span_log2)
        self.assertEqual(finest.span_log2, 24)
        self.assertGreaterEqual(finest.max_points_per_tile, 65_000)

        # Guardrail against re-inverting the ramp: no close or mid zoom level
        # (span_log2 <= 28) may sample below the full bucket count.
        for level in levels:
            if level.span_log2 <= 28:
                self.assertEqual(
                    level.sample_buckets,
                    full,
                    msg=f"span_log2={level.span_log2} must keep every catalog point",
                )

    def test_point_type_codes_never_become_procedural_universe_sprites(self) -> None:
        # Type codes remain useful for identity and hydration, but measured
        # catalog records must render as plain points. Shape/glow branches made
        # galaxies and quasars look like invented filaments and nebulae.
        builder = load_tile_builder()
        renderer_src = (ROOT / "src" / "webglPointRenderer.ts").read_text(encoding="utf-8")
        self.assertEqual(len(builder.POINT_TYPE_CODES), 7)
        for procedural_token in ("v_style", "v_rand", "styleCode", "diffraction", "wobble"):
            self.assertNotIn(procedural_token, renderer_src)
        self.assertIn("gl_FragColor = v_color;", renderer_src)

    def test_smp3_format_and_prefix_lod_invariants_are_explicit(self) -> None:
        builder = load_tile_builder()
        codec = (ROOT / "scripts" / "smp3.py").read_text(encoding="utf-8")
        worker = (ROOT / "src" / "catalogPointTileWorker.ts").read_text(encoding="utf-8")

        self.assertEqual(builder.SMP3_RECORD.size, 8)
        self.assertEqual(builder.SMP3_HEADER.size, 32)
        self.assertIn('default="SMP3"', (ROOT / "scripts" / "build_static_point_tiles.py").read_text(encoding="utf-8"))
        self.assertIn("records must be sorted by encoded magnitude", codec)
        self.assertIn('magic === "SMP3"', worker)
        self.assertIn("SMP3_VERTEX_BYTES = 16", worker)

    def test_all_host_writers_share_one_concurrency_group(self) -> None:
        workflows = ["deploy.yml", "deploy-production.yml", "catalog-tiles.yml"]
        for workflow in workflows:
            source = (ROOT / ".github" / "workflows" / workflow).read_text(encoding="utf-8")
            self.assertIn("group: skychart-deploy-host", source)
            self.assertNotRegex(source, r"group: host-[0-9-]+")
            self.assertIn("cancel-in-progress: false", source)

    def test_default_layers_do_not_duplicate_heavy_gaia_rows(self) -> None:
        builder = load_tile_builder()

        layers = builder.parse_layers(",".join(builder.DEFAULT_LAYERS))
        gaia_groups = set(builder.DEFAULT_GROUPS)
        heavy_layers = [layer for layer in layers if gaia_groups.intersection(layer.groups)]

        self.assertEqual([layer.id for layer in heavy_layers], ["gaia_stars"])
        self.assertEqual(set(heavy_layers[0].groups), gaia_groups)

    def test_default_layers_cover_real_filter_types_and_full_ngc_catalog(self) -> None:
        builder = load_tile_builder()
        layers = {layer.id: layer for layer in builder.parse_layers(",".join(builder.DEFAULT_LAYERS))}

        self.assertEqual(layers["exoplanet_stars"].types, ["star"])
        self.assertEqual(layers["planets"].types, ["planet"])
        self.assertEqual(layers["asteroids"].types, ["asteroid"])
        self.assertEqual(layers["comets"].types, ["comet"])
        self.assertEqual(layers["dwarf_planets"].types, ["dwarf_planet"])
        self.assertNotIn("exoplanet_systems", layers)
        self.assertNotIn("small_bodies", layers)
        for layer_id in ("deep_sky", "galaxies", "nebulae", "star_clusters"):
            self.assertIn("ngc_ic_deep_sky", layers[layer_id].groups)
        self.assertIn("bass_dr2_black_holes", layers["deep_sky"].groups)
        self.assertEqual(
            set(layers["black_holes"].groups),
            {"simbad_compact_objects", "bass_dr2_black_holes"},
        )

    def test_manifest_version_comes_from_explicit_tile_version(self) -> None:
        builder = load_tile_builder()

        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "v2"
            output_dir.mkdir()
            builder.write_manifest(output_dir, [], "v2")
            manifest = (output_dir / "manifest.json").read_text(encoding="utf-8")

        self.assertIn('"version": "v2"', manifest)
        self.assertEqual(builder.normalize_tile_version("", Path("/tmp/catalog-tiles/v3")), "v3")

    def test_catalog_tile_workflow_supports_staging_and_production_shared_artifacts(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "catalog-tiles.yml").read_text(encoding="utf-8")

        self.assertIn("target_environment", workflow)
        self.assertIn("staging", workflow)
        self.assertIn("production", workflow)
        self.assertIn("CATALOG_TILE_VERSION", workflow)
        self.assertIn("CATALOG_TILE_S3_PREFIX", workflow)
        self.assertIn("kamal app exec -d \"$TARGET_ENVIRONMENT\"", workflow)
        self.assertNotIn("catalog_version || 'v1'", workflow)
        self.assertNotRegex(workflow, r"catalog_version:[\s\S]{0,240}default:\s*v1")

    def test_tile_scripts_use_catalog_tile_version_for_output_and_public_paths(self) -> None:
        build_if_needed = (ROOT / "scripts" / "build_static_tiles_if_needed.sh").read_text(encoding="utf-8")
        import_if_needed = (ROOT / "scripts" / "import_catalogs_if_needed.sh").read_text(encoding="utf-8")
        upload = (ROOT / "scripts" / "build_and_upload_static_tiles.sh").read_text(encoding="utf-8")

        for script in [build_if_needed, import_if_needed]:
            self.assertIn('catalog_tile_version="${CATALOG_TILE_VERSION:-v1}"', script)
            self.assertIn("catalog-tiles/$catalog_tile_version", script)
            self.assertIn('--version "$catalog_tile_version"', script)
        self.assertIn('catalog_tile_version="$CATALOG_TILE_VERSION"', upload)
        self.assertIn("Refusing to overwrite immutable release", upload)
        self.assertIn("catalog-tiles/$catalog_tile_version", upload)
        self.assertIn('--version "$catalog_tile_version"', upload)

    def test_catalog_tile_upload_fails_closed_and_conditionally_publishes_manifest(self) -> None:
        script = ROOT / "scripts" / "build_and_upload_static_tiles.sh"

        def run_upload(probe: str, claim: str = "success") -> tuple[subprocess.CompletedProcess[str], str]:
            with tempfile.TemporaryDirectory() as tmp_dir:
                root = Path(tmp_dir)
                log = root / "aws.log"
                aws = root / "aws"
                aws.write_text(
                    "#!/usr/bin/env bash\n"
                    "printf '%s\\n' \"$*\" >> \"$MOCK_AWS_LOG\"\n"
                    "if [[ \"$*\" == *\"list-objects-v2\"* ]]; then\n"
                    "  case \"$MOCK_PROBE\" in\n"
                    "    error) exit 42 ;;\n"
                    "    occupied) printf '%s\\n' 'catalog-tiles/v-test/partial.bin'; exit 0 ;;\n"
                    "    empty) printf '%s\\n' 'None'; exit 0 ;;\n"
                    "  esac\n"
                    "fi\n"
                    "if [[ \"$*\" == *\"/.publishing\"* && \"$MOCK_CLAIM\" == 'error' ]]; then exit 43; fi\n"
                    "exit 0\n",
                    encoding="utf-8",
                )
                aws.chmod(0o755)
                nice = root / "nice"
                nice.write_text(
                    "#!/usr/bin/env bash\n"
                    "while [[ \"$1\" == '-n' || \"$1\" =~ ^[0-9]+$ ]]; do shift; done\n"
                    "if [[ \"$1\" == 'python3' ]]; then\n"
                    "  if [[ \"$2\" == *'compose_bulk_catalog_release.py' ]]; then\n"
                    "    while [[ $# -gt 0 ]]; do\n"
                    "      if [[ \"$1\" == '--output' ]]; then mkdir -p \"$(dirname \"$2\")\"; printf '{}\\n' > \"$2\"; break; fi\n"
                    "      shift\n"
                    "    done\n"
                    "  else\n"
                    "    mkdir -p \"$CATALOG_TILE_OUTPUT_DIR\"\n"
                    "    printf '{}\\n' > \"$CATALOG_TILE_OUTPUT_DIR/manifest.json\"\n"
                    "  fi\n"
                    "  exit 0\n"
                    "fi\n"
                    "\"$@\"\n",
                    encoding="utf-8",
                )
                nice.chmod(0o755)
                env = {
                    **os.environ,
                    "PATH": f"{root}:{os.environ['PATH']}",
                    "AWS_ACCESS_KEY_ID": "test",
                    "AWS_SECRET_ACCESS_KEY": "test",
                    "CATALOG_TILE_PUBLIC_BASE_URL": "https://tiles.example/catalog-tiles/v-test",
                    "CATALOG_TILE_CARRY_FORWARD_MANIFEST_URL": "https://tiles.example/catalog-tiles/v-bulk/manifest.json",
                    "CATALOG_TILE_S3_BUCKET": "test-bucket",
                    "CATALOG_TILE_S3_ENDPOINT_URL": "https://storage.example",
                    "CATALOG_TILE_S3_REGION": "test-region",
                    "CATALOG_TILE_VERSION": "v-test",
                    "CATALOG_TILE_OUTPUT_DIR": str(root / "tiles"),
                    "MOCK_AWS_LOG": str(log),
                    "MOCK_PROBE": probe,
                    "MOCK_CLAIM": claim,
                }
                result = subprocess.run(["bash", str(script)], cwd=ROOT, env=env, text=True, capture_output=True, check=False)
                return result, log.read_text(encoding="utf-8") if log.exists() else ""

        failed_probe, failed_log = run_upload("error")
        self.assertNotEqual(failed_probe.returncode, 0)
        self.assertNotIn("s3 sync", failed_log)

        occupied, occupied_log = run_upload("occupied")
        self.assertNotEqual(occupied.returncode, 0)
        self.assertNotIn("s3 sync", occupied_log)

        lost_claim, lost_claim_log = run_upload("empty", "error")
        self.assertNotEqual(lost_claim.returncode, 0)
        self.assertIn("/.publishing", lost_claim_log)
        self.assertNotIn("s3 sync", lost_claim_log)

        empty, empty_log = run_upload("empty")
        self.assertEqual(empty.returncode, 0, msg=empty.stderr)
        self.assertIn("s3 sync", empty_log)
        self.assertIn("/.publishing", empty_log)
        self.assertIn("s3api put-object", empty_log)
        self.assertIn("--if-none-match *", empty_log)

    def test_runtime_image_and_workflow_include_smp3_build_dependencies(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        workflow = (ROOT / ".github" / "workflows" / "catalog-tiles.yml").read_text(encoding="utf-8")

        self.assertIn("scripts/smp3.py scripts/smp3.py", dockerfile)
        self.assertIn(
            "scripts/compose_bulk_catalog_release.py scripts/compose_bulk_catalog_release.py",
            dockerfile,
        )
        self.assertIn("scripts/configure_catalog_bucket_cors.sh scripts/configure_catalog_bucket_cors.sh", dockerfile)
        self.assertIn('CATALOG_TILE_VERSION:"$CATALOG_TILE_VERSION"', workflow)

    def test_catalog_import_runs_after_deploy_not_before_healthcheck(self) -> None:
        entrypoint = (ROOT / "scripts" / "docker-entrypoint.sh").read_text(encoding="utf-8")
        post_deploy = (ROOT / ".kamal" / "hooks" / "post-deploy").read_text(encoding="utf-8")

        self.assertNotIn("import_catalogs_if_needed.sh", entrypoint)
        self.assertIn("import_catalogs_if_needed.sh", post_deploy)
        self.assertIn("KAMAL_DESTINATION", post_deploy)
        self.assertIn("staging", post_deploy)

    def test_staging_uses_shared_catalog_database_not_own_postgres_accessory(self) -> None:
        deploy = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        staging_config = (ROOT / "config" / "deploy.staging.yml").read_text(encoding="utf-8")
        tile_workflow = (ROOT / ".github" / "workflows" / "catalog-tiles.yml").read_text(encoding="utf-8")

        self.assertIn("STAGING_DATABASE_URL", deploy)
        self.assertIn("STAGING_DATABASE_URL", tile_workflow)
        self.assertNotIn("@skychart-staging-postgres/skychart", deploy)
        self.assertNotIn("@skychart-staging-postgres/skychart", tile_workflow)
        self.assertNotIn("kamal accessory boot postgres -d staging", deploy)
        self.assertNotIn("skychart-staging-postgres-data", staging_config)
        self.assertIn('POOL_SIZE: "2"', staging_config)


if __name__ == "__main__":
    unittest.main()
