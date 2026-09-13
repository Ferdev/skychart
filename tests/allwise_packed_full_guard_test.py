from pathlib import Path
import inspect
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_allwise_packed_full import build


def test_packed_builder_floor_is_explicit_and_defaults_conservatively():
    assert inspect.signature(build).parameters["free_floor_gib"].default == 100
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[1] / "scripts" /
                             "build_allwise_packed_full.py"), "--help"],
        check=True, capture_output=True, text=True,
    )
    assert "--free-floor-gib" in result.stdout
