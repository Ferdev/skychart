import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('registry_audit', ROOT / 'scripts/audit_catalog_registry.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.registry = json.loads((ROOT / 'data/catalog-registry/registry-v1.json').read_text())

    def test_registry_targets_and_no_admitted_release(self):
        audit.validate_registry(self.registry)
        self.assertEqual(self.registry['admitted_releases'], [])
        self.assertEqual(len(self.registry['first_release_set']), 5)

    def test_cannot_promote_subset_or_unreconciled_release(self):
        entry = self.registry['catalogs'][1]
        entry.update(coverage='complete', attribution={'status':'verified'})
        self.registry['admitted_releases'] = [entry['id']]
        for evidence in ({}, {'fetched':1647599, 'accepted':100, 'quarantined':0}):
            entry['admission'] = evidence
            with self.assertRaises(ValueError):
                audit.validate_registry(self.registry)
        entry['admission'] = dict(fetched=1647599, accepted=1647590, quarantined=9,
                                  manifest_sha256='a'*64, schema_sha256='b'*64,
                                  owned_artifact='owned:release/1', capacity_approval='approval/1',
                                  verification_report='reports/1')
        audit.validate_registry(self.registry)
        entry['selection'] = 'TOP 100'
        with self.assertRaisesRegex(ValueError, 'subset'):
            audit.validate_registry(self.registry)

    def test_missing_unknown_and_zero_are_different(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            self.assertIsNone(audit.snapshot_evidence(path, 4096)['records'])
            path.write_text(json.dumps({'objects':[]}))
            self.assertEqual(audit.snapshot_evidence(path,4096)['records'], 0)
            path.write_text(json.dumps({'objects':[
                {'key':'at-sun','distance_pc':0,'ra_deg':0,'dec_deg':0},
                {'key':'Gaia:18446744073709551615','distance_pc':None}]}))
            result = audit.snapshot_evidence(path,4096)
            self.assertEqual(result['records'],2)
            self.assertEqual(result['missing_distance'],1)
            self.assertEqual(result['missing_angular_position'],1)
            self.assertEqual(len(result['sha256']),64)
            self.assertEqual(audit.snapshot_evidence(path,1)['status'],'not_read')
            path.write_text('{"objects": [')
            self.assertEqual(audit.snapshot_evidence(path,4096)['status'],'invalid')

    def test_duplicates_and_path_escape_are_rejected(self):
        bad = copy.deepcopy(self.registry)
        bad['catalogs'].append(bad['catalogs'][0])
        with self.assertRaises(ValueError):
            audit.validate_registry(bad)
        self.registry['catalogs'][0]['local_snapshots'] = ['../secret']
        with self.assertRaises(ValueError):
            audit.validate_registry(self.registry)

    def test_failed_database_is_unknown_not_empty(self):
        with patch.object(audit.subprocess,'run',side_effect=OSError('missing')):
            result = audit.database_evidence()
        self.assertEqual(result['status'],'unavailable')
        self.assertIsNone(result['counts'])


if __name__ == '__main__':
    unittest.main()
