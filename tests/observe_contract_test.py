import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from backend.errors import QueryInputError
from backend.scientific_calculation import observe_payload


class Degrees:
    def __init__(self, values):
        self.degrees = values


class SyntheticObserver:
    def __init__(self, altitudes):
        self.altitudes = altitudes
        self.at_time = None

    def at(self, at_time):
        self.at_time = at_time
        return self

    def observe(self, _target):
        return self

    def apparent(self):
        return self

    def altaz(self):
        if isinstance(self.at_time, list):
            return Degrees(self.altitudes), Degrees([0.0] * len(self.altitudes)), None
        return Degrees(self.altitudes[0]), Degrees(0.0), None


class SyntheticEarth:
    def __init__(self, observer):
        self.observer = observer

    def __add__(self, _location):
        return self.observer


class SyntheticTimescale:
    def from_datetime(self, value):
        return value

    def from_datetimes(self, values):
        return values


class ObserveContractTest(unittest.TestCase):
    def observe_with_altitudes(self, altitudes):
        observer = SyntheticObserver(altitudes)
        with (
            patch(
                "backend.scientific_calculation.skyfield_context",
                return_value=(SyntheticTimescale(), {"earth": SyntheticEarth(observer)}),
            ),
            patch("backend.scientific_calculation.wgs84.latlon", return_value=object()),
        ):
            return observe_payload(
                "hip-27989", 52.52, 13.405, datetime(2026, 1, 15, 22, 0, tzinfo=timezone.utc)
            )

    def test_above_now_reports_set_before_a_later_rise(self):
        altitudes = [10.0] * 289
        altitudes[12:] = [-5.0] * (289 - 12)
        altitudes[24:] = [10.0] * (289 - 24)
        payload = self.observe_with_altitudes(altitudes)
        self.assertEqual(
            payload["summary"],
            "Above the horizon now; sets around 23:00 UTC; next rises around 00:00 UTC.",
        )
        self.assertNotIn("Above the horizon from", payload["summary"])

    def test_below_horizon_keeps_next_rise_wording(self):
        altitudes = [-10.0] * 289
        altitudes[12:] = [10.0] * (289 - 12)
        payload = self.observe_with_altitudes(altitudes)
        self.assertEqual(payload["summary"], "Above the horizon from 23:00 UTC; best around 23:00 UTC.")

    def test_always_up_keeps_best_time_wording(self):
        altitudes = [10.0] * 289
        altitudes[10] = 30.0
        payload = self.observe_with_altitudes(altitudes)
        self.assertEqual(payload["summary"], "Above the horizon now; best around 22:50 UTC.")

    def test_fixed_berlin_betelgeuse_contract(self):
        p=observe_payload("hip-27989",52.52,13.405,datetime(2026,1,15,22,0,tzinfo=timezone.utc)); self.assertAlmostEqual(p["altitude_deg"],44.2,delta=1.0); self.assertTrue(0<=p["azimuth_deg"]<360); self.assertIn("transit_utc",p); self.assertIn("five-minute",p["accuracy_note"])
    def test_rejects_invalid_inputs(self):
        with self.assertRaises(QueryInputError): observe_payload("hip-27989",91,0,datetime.now(timezone.utc))
        with self.assertRaises(QueryInputError): observe_payload("../../secret",0,0,datetime.now(timezone.utc))
if __name__=="__main__": unittest.main()
