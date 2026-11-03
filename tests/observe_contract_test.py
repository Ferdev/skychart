import unittest
from datetime import datetime, timezone
from backend.errors import QueryInputError
from backend.scientific_calculation import observe_payload


class ObserveContractTest(unittest.TestCase):
    def test_fixed_berlin_betelgeuse_contract(self):
        p=observe_payload("hip-27989",52.52,13.405,datetime(2026,1,15,22,0,tzinfo=timezone.utc)); self.assertAlmostEqual(p["altitude_deg"],44.2,delta=1.0); self.assertTrue(0<=p["azimuth_deg"]<360); self.assertIn("transit_utc",p); self.assertIn("five-minute",p["accuracy_note"])
    def test_an_object_that_is_up_is_above_the_horizon_now(self):
        p=observe_payload("hip-27989",52.52,13.405,datetime(2026,1,15,22,0,tzinfo=timezone.utc))
        self.assertGreater(p["altitude_deg"],0); self.assertIsNotNone(p["set_utc"]); self.assertGreater(p["rise_utc"],p["set_utc"])
        self.assertTrue(p["summary"].startswith("Above the horizon now; best around "),p["summary"])
    def test_an_object_that_is_down_is_above_the_horizon_from_its_rise(self):
        p=observe_payload("hip-27989",52.52,13.405,datetime(2026,1,15,10,0,tzinfo=timezone.utc))
        self.assertLess(p["altitude_deg"],0); self.assertIsNotNone(p["rise_utc"])
        self.assertEqual(p["summary"].split(";")[0],f"Above the horizon from {p['rise_utc'][11:16]} UTC")
    def test_rejects_invalid_inputs(self):
        with self.assertRaises(QueryInputError): observe_payload("hip-27989",91,0,datetime.now(timezone.utc))
        with self.assertRaises(QueryInputError): observe_payload("../../secret",0,0,datetime.now(timezone.utc))
if __name__=="__main__": unittest.main()
