from __future__ import annotations

import unittest

from backend.scientific_calculation import (
    parse_horizons_state_vector,
    small_body_horizons_command,
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


if __name__ == "__main__":
    unittest.main()
