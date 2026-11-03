import unittest
from datetime import datetime, timezone
from backend.errors import QueryInputError
from backend.scientific_calculation import observe_payload


class ObserveContractTest(unittest.TestCase):
    def test_fixed_berlin_betelgeuse_contract(self):
        p=observe_payload("hip-27989",52.52,13.405,datetime(2026,1,15,22,0,tzinfo=timezone.utc)); self.assertAlmostEqual(p["altitude_deg"],44.2,delta=1.0); self.assertTrue(0<=p["azimuth_deg"]<360); self.assertIn("transit_utc",p); self.assertIn("five-minute",p["accuracy_note"])
    def test_rejects_invalid_inputs(self):
        with self.assertRaises(QueryInputError): observe_payload("hip-27989",91,0,datetime.now(timezone.utc))
        with self.assertRaises(QueryInputError): observe_payload("../../secret",0,0,datetime.now(timezone.utc))
if __name__=="__main__": unittest.main()
