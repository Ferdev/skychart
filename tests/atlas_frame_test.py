"""Solar System vectors and catalog positions must share one fixed J2000 ecliptic frame."""
import json
import math
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import numpy as np
from skyfield.positionlib import ICRF

from backend import scientific_calculation as science
from backend.settings import AU_KM

RA_DEG, DEC_DEG = 142.0594, 16.6475
DISTANCE_PC = 10.0
EPOCHS = (datetime(1950, 1, 1, tzinfo=timezone.utc), datetime(2050, 1, 1, tzinfo=timezone.utc))


def icrf_unit_vector() -> np.ndarray:
    ra, dec = math.radians(RA_DEG), math.radians(DEC_DEG)
    return np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])


def star_direction() -> np.ndarray:
    star = science.radec_distance_position_payload({"name": "Star", "ra_deg": RA_DEG, "dec_deg": DEC_DEG, "distance_pc": DISTANCE_PC})
    return np.array([star["x_au"], star["y_au"], star["z_au"]]) / star["heliocentric_distance_km"] * AU_KM


def horizons_response(position_km: np.ndarray) -> MagicMock:
    x, y, z = position_km
    result = f"$$SOE\n X ={x:.15E} Y ={y:.15E} Z ={z:.15E}\n VX= 1.0E+00 VY= 0.0E+00 VZ= 0.0E+00\n$$EOE"
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps({"result": result}).encode()
    return response


class AtlasFrameTest(unittest.TestCase):
    def test_skyfield_vector_matches_star_rotation_at_any_epoch(self):
        vector = ICRF(icrf_unit_vector())
        payload = science.vector_payload(vector)
        direction = np.array([payload["x_au"], payload["y_au"], payload["z_au"]])
        np.testing.assert_allclose(direction, star_direction(), atol=1e-12)

    def test_horizons_vector_matches_star_rotation_at_any_epoch(self):
        position_km = icrf_unit_vector() * AU_KM
        for epoch in EPOCHS:
            science._horizons_vectors.clear()
            with (
                patch.object(science, "urlopen", return_value=horizons_response(position_km)),
                patch.object(science, "read_cache", return_value=None),
                patch.object(science, "write_cache"),
            ):
                payload = science.horizons_vector_payload({"key": "ceres", "name": "Ceres", "horizons_id": "1;", "parent_key": "sun"}, epoch)
            direction = np.array([payload["x_km"], payload["y_km"], payload["z_km"]]) / AU_KM
            np.testing.assert_allclose(direction, star_direction(), atol=1e-12)

    def test_frame_rotation_keeps_length(self):
        rotated = science.ICRF_TO_ATLAS_ECLIPTIC.dot(icrf_unit_vector())
        self.assertAlmostEqual(float(np.linalg.norm(rotated)), 1.0, places=12)


if __name__ == "__main__":
    unittest.main()
