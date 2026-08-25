import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
STAGING_WORKFLOW = ROOT / ".github" / "workflows" / "deploy.yml"
DEPLOY_CONFIG = ROOT / "config" / "deploy.yml"
STORAGE_CHECK = ROOT / "scripts" / "verify_deploy_storage.sh"


def test_staging_deploy_enforces_retention_and_storage_headroom():
    workflow = STAGING_WORKFLOW.read_text()
    deploy_config = DEPLOY_CONFIG.read_text()

    assert "retain_containers: 2" in deploy_config
    assert 'MINIMUM_DEPLOY_FREE_GIB: "6"' in workflow
    assert workflow.count("kamal prune all -d staging") == 2

    pre_prune = workflow.index("kamal prune all -d staging")
    storage_check = workflow.index("bash scripts/verify_deploy_storage.sh")
    deploy = workflow.index("kamal redeploy -d staging")
    smoke = workflow.index("curl -fsS https://staging.skychart.org/api/health")
    post_prune = workflow.rindex("kamal prune all -d staging")

    assert pre_prune < storage_check < deploy < smoke < post_prune
    assert "docker system prune" not in workflow
    assert "docker volume prune" not in workflow


def run_storage_check(tmp_path: Path, report: str, minimum_free_gib: str = "6"):
    fake_ssh = tmp_path / "ssh"
    fake_ssh.write_text(f"#!/usr/bin/env bash\nprintf '%s\\n' '{report}'\n")
    fake_ssh.chmod(0o755)

    env = os.environ.copy()
    env.update(
        {
            "DEPLOY_HOST": "skychart.example",
            "MINIMUM_DEPLOY_FREE_GIB": minimum_free_gib,
            "PATH": f"{tmp_path}:{env['PATH']}",
        }
    )
    return subprocess.run(
        ["bash", str(STORAGE_CHECK)],
        capture_output=True,
        check=False,
        env=env,
        text=True,
    )


def test_storage_check_accepts_sufficient_root_and_docker_space(tmp_path):
    eight_gib_kib = str(8 * 1024 * 1024)

    result = run_storage_check(
        tmp_path,
        f"SKYCHART_STORAGE|{eight_gib_kib}|{eight_gib_kib}|/var/lib/docker",
    )

    assert result.returncode == 0
    assert "Storage headroom OK: root 8 GiB free" in result.stdout


def test_storage_check_rejects_low_root_space(tmp_path):
    five_gib_kib = str(5 * 1024 * 1024)
    eight_gib_kib = str(8 * 1024 * 1024)

    result = run_storage_check(
        tmp_path,
        f"SKYCHART_STORAGE|{five_gib_kib}|{eight_gib_kib}|/var/lib/docker",
    )

    assert result.returncode == 1
    assert "root filesystem space" in result.stderr
    assert "5 GiB free, 6 GiB required" in result.stderr


def test_storage_check_rejects_low_docker_space(tmp_path):
    five_gib_kib = str(5 * 1024 * 1024)
    eight_gib_kib = str(8 * 1024 * 1024)

    result = run_storage_check(
        tmp_path,
        f"SKYCHART_STORAGE|{eight_gib_kib}|{five_gib_kib}|/mnt/docker",
    )

    assert result.returncode == 1
    assert "Docker storage space at /mnt/docker" in result.stderr
    assert "5 GiB free, 6 GiB required" in result.stderr


def test_storage_check_rejects_malformed_remote_output(tmp_path):
    result = run_storage_check(tmp_path, "not-a-storage-report")

    assert result.returncode == 1
    assert "Could not read root and Docker storage headroom" in result.stderr
