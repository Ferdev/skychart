import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]


def load_script(name: str):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("script", ["gaia_bulk_pipeline", "desi_bulk_pipeline"])
def test_bulk_pipelines_require_explicit_workstation_opt_in(monkeypatch, script):
    module = load_script(script)
    monkeypatch.delenv("SKYCHART_APPLICATION_HOST", raising=False)
    monkeypatch.delenv("SKYCHART_ALLOW_BULK_PIPELINE", raising=False)

    with pytest.raises(SystemExit, match="disabled by default"):
        module.refuse_application_host()

    monkeypatch.setenv("SKYCHART_ALLOW_BULK_PIPELINE", "1")
    module.refuse_application_host()


@pytest.mark.parametrize("script", ["gaia_bulk_pipeline", "desi_bulk_pipeline"])
def test_application_host_refusal_wins_over_opt_in(monkeypatch, script):
    module = load_script(script)
    monkeypatch.setenv("SKYCHART_APPLICATION_HOST", "1")
    monkeypatch.setenv("SKYCHART_ALLOW_BULK_PIPELINE", "1")

    with pytest.raises(SystemExit, match="application host"):
        module.refuse_application_host()
