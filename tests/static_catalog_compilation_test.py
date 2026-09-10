from pathlib import Path
import sys
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from measure_static_catalog_compilation import extract


SOURCE = '''
CATALOG_GROUPS = {"core": {"label": "Core"}}
def catalog_object(key, radius=None, mu=0):
    return {"key": key, "radius": radius, "mu": mu}
CATALOG_OBJECTS = [catalog_object(key="a", mu=SUN_MU_KM3_S2), catalog_object(key="b", radius=0)]
raise RuntimeError("module-level code must never run")
'''


def test_static_extraction_keeps_defaults_zero_and_constant_without_module_execution():
    rows, groups = extract(SOURCE, 'SUN_MU_KM3_S2 = 132712440018.0')
    assert rows == [{'key': 'a', 'radius': None, 'mu': 132712440018.0}, {'key': 'b', 'radius': 0, 'mu': 0}]
    assert groups == {'core': {'label': 'Core'}}


def test_dynamic_constructor_or_input_is_rejected():
    with pytest.raises(ValueError):
        extract(SOURCE.replace('"radius": radius', '"radius": float(radius)'), 'SUN_MU_KM3_S2 = 1')
    with pytest.raises(ValueError):
        extract(SOURCE.replace('radius=0', 'radius=float("0")'), 'SUN_MU_KM3_S2 = 1')
