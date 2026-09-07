import json
import math
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from backend import spacecraft as sc
from backend.scientific_calculation import horizons_vector_payload

EPOCH = datetime(2026, 9, 6, tzinfo=timezone.utc)

class SpacecraftTest(unittest.TestCase):
    def setUp(self):
        sc._retry_after = 0

    def test_launch_parser_does_not_confuse_flybys_with_launch(self):
        from scripts.audit_spacecraft import launch_date
        self.assertIsNone(launch_date("Post-launch trajectory\n2026-Aug-20 prediction"))
        self.assertIsNone(launch_date("Launched in 2004\n2005-Aug-02 Earth flyby"))
        self.assertEqual(launch_date("Launch : Aug 5, 2011 16:25 UTC"), "2011-08-05")

    def test_inventory_identity_and_provenance(self):
        missions = list(sc.MISSIONS.values())
        self.assertGreaterEqual(len(missions), 90)
        self.assertEqual(len(missions), len({m['horizons_id'] for m in missions}))
        for mission in missions:
            self.assertLess(mission['jd_start_tdb'], mission['jd_end_tdb'])
            self.assertEqual(mission['key'], 'spacecraft-' + mission['horizons_id'][1:])
            self.assertEqual(len(mission['source_sha256']), 64)
        self.assertIn('JWST', sc.MISSIONS['spacecraft-170']['aliases'])
        self.assertTrue(sc.MANIFEST['excluded'])

    def test_tdb_boundaries_and_termination(self):
        ts = MagicMock()
        mission = sc.MISSIONS['spacecraft-31']
        with patch('backend.scientific_calculation.skyfield_context', return_value=(ts, None)):
            for jd, expected in [(mission['jd_start_tdb']-1e-6,False), (mission['jd_start_tdb'],True),
                                 (mission['jd_end_tdb'],True), (mission['jd_end_tdb']+1e-6,False)]:
                ts.from_datetime.return_value.tdb = jd
                self.assertEqual(sc.in_coverage(mission,EPOCH), expected)
            ts.from_datetime.return_value.tdb = sc.MISSIONS['spacecraft-135']['jd_start_tdb']+1
            self.assertFalse(sc.in_coverage(sc.MISSIONS['spacecraft-135'],EPOCH))

    def test_missing_position_is_null_and_never_calls_provider(self):
        with patch.object(sc, 'in_coverage', return_value=False), patch('backend.scientific_calculation.horizons_vector_payload') as fetch:
            body = sc.calculate(sc.MISSIONS['spacecraft-82'], EPOCH)
        fetch.assert_not_called()
        self.assertIsNone(body['position'])
        self.assertIsNone(body['distance_from_earth_km'])
        self.assertIsNone(body['radius_km'])
        json.dumps(body, allow_nan=False)

    def test_gap_and_outage_do_not_leave_old_coordinates(self):
        for failure in (RuntimeError('No ephemeris for target'), OSError('offline')):
            with patch.object(sc,'in_coverage',return_value=True), patch('backend.scientific_calculation.horizons_vector_payload',side_effect=failure):
                body = sc.calculate(sc.MISSIONS['spacecraft-31'],EPOCH)
            self.assertEqual(body['spacecraft']['availability'],'temporarily_unavailable')
            self.assertIsNone(body['position'])

    def test_distance_uses_three_dimensions_at_same_epoch(self):
        position = dict(x_km=3,y_km=4,z_km=12,x_au=3/149597870.7,y_au=4/149597870.7,z_au=12/149597870.7,
                        vx_km_s=0,vy_km_s=3,vz_km_s=4,heliocentric_distance_km=13)
        ts, eph = MagicMock(), MagicMock()
        with patch.object(sc,'in_coverage',return_value=True), patch('backend.scientific_calculation.horizons_vector_payload',return_value=position) as fetch, patch('backend.scientific_calculation.skyfield_context',return_value=(ts,eph)), patch('backend.scientific_calculation.vector_payload',return_value=dict(x_km=0,y_km=0,z_km=0)):
            body = sc.calculate(sc.MISSIONS['spacecraft-31'], EPOCH)
        self.assertEqual(body['distance_from_earth_km'],13)
        self.assertEqual(body['spacecraft']['heliocentric_speed_km_s'],5)
        self.assertEqual(fetch.call_args.args[1], EPOCH)
        ts.from_datetime.assert_called_with(EPOCH)
        self.assertEqual(fetch.call_args.args[0]['parent_key'],'sun')

    def test_network_failure_backs_off_subsequent_craft(self):
        with patch.object(sc, 'in_coverage', return_value=True), patch('backend.scientific_calculation.horizons_vector_payload', side_effect=OSError('offline')) as fetch:
            sc.calculate(sc.MISSIONS['spacecraft-31'], EPOCH)
            other = sc.calculate(sc.MISSIONS['spacecraft-32'], EPOCH)
        self.assertEqual(fetch.call_count, 1)
        self.assertIsNone(other['position'])

    def test_python_search_does_not_request_spacecraft_positions(self):
        from backend.scientific_calculation import catalog_search_payload
        mission = {**sc.MISSIONS['spacecraft-31'], 'source_type':'spacecraft'}
        with patch('backend.scientific_calculation.filtered_catalog_objects', return_value=[mission]), patch('backend.scientific_calculation.body_payloads', return_value=([], {})) as bodies, patch.object(sc,'calculate') as calculate:
            payload = catalog_search_payload(EPOCH, ['spacecraft'], [], 'Voyager', 0, 80)
        bodies.assert_called_once_with(EPOCH, [])
        calculate.assert_not_called()
        self.assertIsNone(payload['bodies'][0]['position'])

    def test_group_ephemeris_defers_missions_but_explicit_keys_resolve(self):
        from backend.scientific_calculation import ephemeris_payload
        mission = {**sc.MISSIONS['spacecraft-31'], 'source_type':'spacecraft', 'object_type':'spacecraft', 'catalog_group':'spacecraft'}
        with patch('backend.scientific_calculation.catalog_objects_for_selection', return_value=[mission]), patch('backend.scientific_calculation.body_payloads', return_value=([], {})) as bodies, patch('backend.scientific_calculation.catalog_summary_payload', return_value={}):
            payload = ephemeris_payload(EPOCH, ['spacecraft'])
            bodies.assert_called_once_with(EPOCH, [])
            self.assertIsNone(payload['bodies'][0]['position'])
            bodies.reset_mock()
            ephemeris_payload(EPOCH, [], ['spacecraft-31'])
            bodies.assert_called_once_with(EPOCH, [mission])

    def test_nonfinite_provider_state_is_rejected(self):
        vector = dict(x_km=math.nan,y_km=0,z_km=0,vx_km_s=0,vy_km_s=0,vz_km_s=0)
        with patch.object(sc,'in_coverage',return_value=True), patch('backend.scientific_calculation.horizons_vector_payload',return_value=vector):
            self.assertIsNone(sc.calculate(sc.MISSIONS['spacecraft-31'], EPOCH)['position'])

    def test_catalog_poll_is_nonblocking_and_bounded(self):
        with patch.object(sc,'_worker',True), patch.object(sc,'in_coverage',return_value=True), patch.object(sc,'read_cache',return_value=None):
            payload = sc.spacecraft_payload(EPOCH,'spacecraft-31')
            self.assertEqual(len(payload['bodies']),len(sc.MISSIONS))
            self.assertTrue(all(b['spacecraft']['availability']=='loading' for b in payload['bodies']))
            size=sc._jobs.qsize()
            sc.spacecraft_payload(EPOCH,'spacecraft-31')
            self.assertEqual(sc._jobs.qsize(),size)
            self.assertLessEqual(size,256)
            self.assertEqual(sc._jobs.queue[0][3]['key'],'spacecraft-31')
        with sc._lock:
            sc._pending.clear()
            while not sc._jobs.empty(): sc._jobs.get_nowait(); sc._jobs.task_done()

if __name__ == '__main__': unittest.main()
