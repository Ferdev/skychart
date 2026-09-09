import math
import unittest
from skyfield.api import load
from skyfield.framelib import ecliptic_J2000_frame
from skyfield.positionlib import ICRF
from backend.catalog_astrometry import FRAME, propagate_direction, physical_parallax_distance
from backend.scientific_calculation import vector_payload
from backend.payload_cache import cache_key_payload


class CatalogAstrometryTest(unittest.TestCase):
    def test_fixed_frame_matches_independent_skyfield_reference_at_multiple_epochs(self):
        ts = load.timescale(builtin=True)
        for epoch in (1900, 2000, 2016, 2026, 2100):
            vector = ICRF((0.3, 0.4, 0.5), t=ts.J(epoch))
            expected = vector.frame_xyz(ecliptic_J2000_frame).au
            actual = vector_payload(vector)
            for axis, value in zip('xyz', expected):
                self.assertAlmostEqual(actual[axis+'_au'], value, delta=3e-10)
            self.assertAlmostEqual(actual['x_au'], 0.3)

    def test_tangent_motion_is_finite_at_poles_and_missing_motion_retains_epoch(self):
        ra, dec, epoch = propagate_direction(359.9, 89.999, 10000, 10000, 2000, 2100)
        self.assertTrue(0 <= ra < 360)
        self.assertTrue(-90 < dec < 90)
        self.assertEqual(epoch, 2100)
        self.assertEqual(propagate_direction(12, 13, None, 10, 2016, 2026), (12, 13, 2016))
        ra, dec, _ = propagate_direction(0, 0, 3600000, 0, 2000, 2001)
        self.assertAlmostEqual(ra, math.degrees(math.atan(math.pi/180)), places=12)
        self.assertEqual(dec, 0)

    def test_placement_does_not_accept_negative_missing_or_low_significance_parallax(self):
        for parallax, error in ((None,1),(-1,1),(0,1),(1,1),(1,None),(1,0)):
            self.assertIsNone(physical_parallax_distance(parallax,error))
        estimate = physical_parallax_distance(10,1)
        self.assertEqual(estimate['distance_pc'],100)
        self.assertEqual(estimate['parallax_error_mas'],1)
        self.assertEqual(estimate['model'],'parallax_estimate')

    def test_new_cache_keys_cannot_read_old_frame_payloads(self):
        self.assertEqual(cache_key_payload('ephemeris')['frame_contract'],FRAME)


if __name__ == '__main__':
    unittest.main()
