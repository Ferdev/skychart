import copy
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('staging', ROOT / 'scripts/stage_catalog_release.py')
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)


class CatalogStagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.target = self.root / 'owned'
        self.manifest = dict(schema_version=1, provider='fixture', catalog='sources', release='v1',
            documentation='fixture:source-schema', angular_frame='ICRS', source_epoch=2016.0,
            fields=[dict(name=n,type=t,unit=u) for n,t,u in [
                ('id','id',None),('ra','float','deg'),('dec','float','deg'),
                ('parallax','float','mas'),('error','float','mas')]],
            mapping=dict(id='id',ra='ra',dec='dec',parallax='parallax',parallax_error='error'),
            files=[], expected_rows=0)

    def part(self, name, text, count, **options):
        data = gzip.compress(text.encode(), mtime=0) if options.get('compression') == 'gzip' else text.encode()
        (self.source/name).write_bytes(data)
        self.manifest['files'].append(dict(name=name,sha256=hashlib.sha256(data).hexdigest(),rows=count,format='csv',**options))
        self.manifest['expected_rows'] += count

    def records(self, manifest=None):
        release = self.target/staging.manifest_id(manifest or self.manifest)
        with sqlite3.connect(release/'records.sqlite') as db:
            return db.execute('SELECT source_id,payload,sha256 FROM records ORDER BY source_id').fetchall()

    def test_interrupt_resume_and_reordered_files_are_identical(self):
        self.part('b.csv','id,ra,dec,parallax,error\n18446744073709551615,0,0,-1,1\nno-position,,,10,1\n',2)
        self.part('a.csv.gz','id,ra,dec,parallax,error\nmeasured,90,0,10,1\nangular,0,0,,\nbad,999,0,1,1\n',3,compression='gzip')
        first=staging.stage(self.manifest,self.source,self.target,max_records=1,batch_size=1)
        self.assertEqual(first['state'],'paused')
        release=self.target/first['release_id']
        self.assertFalse((release/'seal.json').exists())
        self.manifest['files'].reverse()
        result=staging.stage(self.manifest,self.source,self.target)
        self.assertEqual((result['fetched'],result['accepted'],result['quarantined']),(5,4,1))
        self.assertEqual(result['known_distance'],2)  # Includes distance evidence without coordinates.
        self.assertEqual(result['unknown_distance'],2)
        records=self.records()
        self.assertEqual(records[0][0],'18446744073709551615')
        self.assertEqual(staging.stage(self.manifest,self.source,self.target),result)
        fresh=self.root/'fresh'
        staging.stage(self.manifest,self.source,fresh)
        with sqlite3.connect(fresh/result['release_id']/'records.sqlite') as db:
            self.assertEqual(records,db.execute('SELECT source_id,payload,sha256 FROM records ORDER BY source_id').fetchall())

    def test_failed_refresh_and_rollback_preserve_unrelated_sources(self):
        self.part('a.csv','id,ra,dec,parallax,error\na,0,0,,\n',1)
        first=staging.stage(self.manifest,self.source,self.target)
        release=self.target/first['release_id']
        staging.activate(release,self.target)
        other=copy.deepcopy(self.manifest);other['catalog']='other'
        second=staging.stage(other,self.source,self.target)
        staging.activate(self.target/second['release_id'],self.target)
        before=(self.target/'active-staging.json').read_bytes()
        changed=copy.deepcopy(self.manifest);changed['release']='v2';changed['expected_rows']=2;changed['files'][0]['rows']=2
        with self.assertRaisesRegex(ValueError,'row count'):
            staging.stage(changed,self.source,self.target)
        with self.assertRaises(FileNotFoundError):
            staging.activate(self.target/staging.manifest_id(changed),self.target)
        self.assertEqual(before,(self.target/'active-staging.json').read_bytes())
        staging.activate(release,self.target)
        self.assertEqual(len(json.loads((self.target/'active-staging.json').read_text())),2)

    def test_header_drift_and_truncated_gzip_cannot_seal(self):
        self.part('a.csv','id,wrong,dec,parallax,error\na,0,0,1,1\n',1)
        with self.assertRaisesRegex(ValueError,'header'):
            staging.stage(self.manifest,self.source,self.target)
        self.manifest['files']=[];self.manifest['expected_rows']=0
        self.part('a.gz','id,ra,dec,parallax,error\na,0,0,1,1\n',1,compression='gzip')
        path=self.source/'a.gz';path.write_bytes(path.read_bytes()[:-8])
        self.manifest['files'][0]['sha256']=staging.digest(path)
        with self.assertRaises(EOFError):
            staging.stage(self.manifest,self.source,self.target)
        self.assertFalse((self.target/staging.manifest_id(self.manifest)/'seal.json').exists())

    def test_duplicate_ids_are_accounted_and_owned_source_corruption_is_detected(self):
        self.part('a.csv','id,ra,dec,parallax,error\na,0,0,1,1\na,0,0,1,1\n',2)
        result=staging.stage(self.manifest,self.source,self.target)
        self.assertEqual((result['accepted'],result['quarantined']),(1,1))
        release=self.target/result['release_id']
        (release/'inputs/a.csv').write_text('changed')
        with self.assertRaisesRegex(ValueError,'source changed'):
            staging.verify(release)

    def test_ecsv_and_votable_readers_keep_nulls_and_reject_binary_tables(self):
        from catalog_source_adapter import rows
        path=self.source/'sample'
        path.write_text('# %ECSV 1.0\n# schema\nid,ra,dec,parallax,error\na,0,0,,\n')
        self.assertEqual(list(rows(path,dict(format='ecsv'),self.manifest['fields'])),[['a','0','0','','']])
        path.write_text('<VOTABLE><RESOURCE><TABLE>'+''.join(f'<FIELD name="{f["name"]}"/>' for f in self.manifest['fields'])+'<DATA><TABLEDATA><TR><TD>a</TD><TD>0</TD><TD>0</TD><TD/><TD/></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>')
        self.assertEqual(list(rows(path,dict(format='votable'),self.manifest['fields'])),[['a','0','0',None,None]])
        path.write_text('<VOTABLE><RESOURCE><TABLE><DATA><BINARY/></DATA></TABLE></RESOURCE></VOTABLE>')
        with self.assertRaises(ValueError):
            list(rows(path,dict(format='votable'),self.manifest['fields']))

    def test_fits_reader_and_fixed_width_keep_record_ids(self):
        import fitsio
        import numpy as np
        from catalog_source_adapter import rows
        path = self.source/'sample.fits'
        table = np.array([('18446744073709551615', 0, 0, float('nan'), 1)],
                         dtype=[('id','U20'),('ra','f8'),('dec','f8'),('parallax','f8'),('error','f8')])
        fitsio.write(path,table)
        actual = list(rows(path,dict(format='fits'),self.manifest['fields']))
        self.assertEqual(actual[0][0],'18446744073709551615')
        self.assertIsNone(actual[0][3])
        path = self.source/'fixed'
        path.write_text('0001  42\nshort\n')
        fields=[dict(name='id',start=0,width=4),dict(name='value',start=6,width=2)]
        self.assertEqual(list(rows(path,dict(format='cds_fixed'),fields)),[['0001','42'],[]])

    def test_budget_and_unit_mismatch_fail_before_staging(self):
        self.part('a.csv','id,ra,dec,parallax,error\na,0,0,1,1\n',1)
        with self.assertRaisesRegex(ValueError,'budget'):
            staging.stage(self.manifest,self.source,self.target,max_source_bytes=1)
        self.manifest['fields'][1]['unit']='rad'
        with self.assertRaisesRegex(ValueError,'units'):
            staging.stage(self.manifest,self.source,self.target)


if __name__ == '__main__':
    unittest.main()
