import json
from pathlib import Path
import sys
import tempfile
import unittest
import ijson
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from download_sbdb_storage_source import audit


class SbdbSourceAuditTest(unittest.TestCase):
    def test_full_accounting_lossless_ids_and_duplicate_rejection(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'source.json';fields=['spkid','value']
            data={'fields':fields,'count':2,'data':[[9007199254740993,None],[9007199254740994,'-0.00001']]}
            p.write_text(json.dumps(data));r=audit(p,fields)
            self.assertEqual(r['rows'],2);self.assertIsNone(r['full_serving_bytes'])
            data['count']=3;p.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'accounting'):audit(p,fields)
            data['count']=2;data['data'][1][0]=9007199254740993;p.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'duplicate'):audit(p,fields)

    def test_truncated_export_and_reordered_schema_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'source.json'
            p.write_text('{"fields":["spkid","value"],"count":2,"data":[[1,null],[2,')
            with self.assertRaises(ijson.JSONError):
                audit(p,['spkid','value'])
            with self.assertRaisesRegex(ValueError,'spkid as first'):
                audit(p,['value','spkid'])

    def test_category_membership_is_checked(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'source.json'; fields=['spkid','value','kind']
            p.write_text(json.dumps({'fields':fields,'count':1,'data':[['9007199254740993',None,'cu']]}))
            self.assertEqual(audit(p,fields,'cu')['rows'],1)
            with self.assertRaisesRegex(ValueError,'category mismatch'):
                audit(p,fields,'cn')


if __name__=='__main__':unittest.main()
