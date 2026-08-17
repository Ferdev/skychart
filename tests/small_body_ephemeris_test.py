from __future__ import annotations

import unittest
from datetime import datetime, timezone
from urllib.error import URLError
from unittest import mock

from backend.scientific_calculation import (
    AU_KM,
    orbit_points_from_rows,
    parse_horizons_state_vector,
    parse_horizons_state_vector_series,
    small_body_ephemeris_payload,
    small_body_ephemeris_unavailable,
    small_body_horizons_command,
    small_body_orbit_payload,
    small_body_orbit_unavailable,
)


class SmallBodyEphemerisTest(unittest.TestCase):
    def test_parser_ignores_osculating_state_in_small_body_header(self) -> None:
        result = """
Equivalent ICRF heliocentric cartesian coordinates (au, au/d):
 X=-4.098530841632175E-01 Y=9.070198866066711E-01 Z=3.267919471115156E-01
 VX=-1.507552412168823E-02 VY=-3.713559927658847E-03 VZ=-1.761867987218290E-03
$$SOE
2462240.406944444 = A.D. 2029-Apr-13 21:46:00.0000 UT
 X =-1.372570000000000E+08 Y =-6.060000000000000E+07 Z =1.040000000000000E+04
 VX=1.789000000000000E+01 VY=-2.396000000000000E+01 VZ=1.846000000000000E+00
$$EOE
"""

        position, velocity = parse_horizons_state_vector(result, "Apophis")

        self.assertEqual(position, [-137_257_000.0, -60_600_000.0, 10_400.0])
        self.assertEqual(velocity, [17.89, -23.96, 1.846])

    def test_numbered_asteroid_command_has_disambiguating_semicolon(self) -> None:
        self.assertEqual(small_body_horizons_command("99942"), "99942;")
        self.assertEqual(small_body_horizons_command("2024 PT5"), "DES=2024 PT5;")

    def test_horizons_outage_raises_oserror_so_transport_can_degrade(self) -> None:
        with mock.patch(
            "backend.scientific_calculation.urlopen",
            side_effect=URLError("offline"),
        ):
            with self.assertRaises(OSError):
                small_body_ephemeris_payload("99942", datetime(2029, 4, 13, 21, 46, tzinfo=timezone.utc))

    def test_unavailable_payload_keeps_explicit_missing_position(self) -> None:
        payload = small_body_ephemeris_unavailable(
            "99942",
            datetime(2029, 4, 13, 21, 46, tzinfo=timezone.utc),
            URLError("offline"),
        )

        self.assertIsNone(payload["position"])
        self.assertIsNone(payload["distance_from_earth_km"])
        self.assertEqual(payload["position_model"], "horizons_unavailable")
        self.assertEqual(payload["designation"], "99942")
        self.assertEqual(payload["timestamp_utc"], "2029-04-13T21:46:00Z")
        self.assertIn("offline", payload["error"])

    def test_series_parser_reads_every_vector_record(self) -> None:
        result = """
$$SOE
2462060.500000000 = A.D. 2028-Oct-15 09:46:00.0000 UT
 X =-1.000000000000000E+08 Y =-6.000000000000000E+07 Z =1.000000000000000E+04
 VX=1.700000000000000E+01 VY=-2.300000000000000E+01 VZ=1.800000000000000E+00
2462240.406944444 = A.D. 2029-Apr-13 21:46:00.0000 UT
 X =-1.372570000000000E+08 Y =-6.060000000000000E+07 Z =1.040000000000000E+04
 VX=1.789000000000000E+01 VY=-2.396000000000000E+01 VZ=1.846000000000000E+00
$$EOE
"""

        rows = parse_horizons_state_vector_series(result, "Apophis")

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][0], 2462060.5)
        self.assertEqual(rows[0][1], [-100_000_000.0, -60_000_000.0, 10_000.0])
        self.assertEqual(rows[1][0], 2462240.406944444)
        self.assertEqual(rows[1][1], [-137_257_000.0, -60_600_000.0, 10_400.0])
        self.assertEqual(rows[1][2], [17.89, -23.96, 1.846])

    def test_series_parser_rejects_a_missing_vector_table(self) -> None:
        with self.assertRaises(RuntimeError):
            parse_horizons_state_vector_series("no table here", "Apophis")

    def test_orbit_outage_raises_oserror_so_transport_can_degrade(self) -> None:
        with mock.patch(
            "backend.scientific_calculation.urlopen",
            side_effect=URLError("offline"),
        ):
            with self.assertRaises(OSError):
                small_body_orbit_payload("99942", datetime(2029, 4, 13, 21, 46, tzinfo=timezone.utc), 323.5)

    def test_orbit_unavailable_payload_keeps_explicit_missing_points(self) -> None:
        payload = small_body_orbit_unavailable(
            "99942",
            datetime(2029, 4, 13, 21, 46, tzinfo=timezone.utc),
            323.5,
            URLError("offline"),
        )

        self.assertIsNone(payload["points"])
        self.assertEqual(payload["position_model"], "horizons_unavailable")
        self.assertEqual(payload["designation"], "99942")
        self.assertIn("offline", payload["error"])

    def test_orbit_points_replace_coarse_rows_with_the_fine_window(self) -> None:
        class IdentityRotation:
            def dot(self, vector):
                return vector

        coarse = [
            (2462000.0, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            (2462001.0, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            (2462002.0, [2.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            (2462003.0, [3.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
        ]
        fine = [
            (2462001.5, [10.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            (2462002.5, [20.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
        ]

        points = orbit_points_from_rows(coarse, fine, IdentityRotation())
        xs = [point["x_au"] * AU_KM for point in points]

        self.assertEqual(len(points), 5)
        for actual, expected in zip(xs, [0.0, 1.0, 10.0, 20.0, 3.0]):
            self.assertAlmostEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
