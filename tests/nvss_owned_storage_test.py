import gzip
from pathlib import Path
import sqlite3
import sys
from unittest.mock import patch
import pyarrow.parquet as pq
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_nvss_owned_storage import convert,position,add_group


def test_full_text_fields_trailing_blanks_and_radio_limits(tmp_path):
    fields=[{'name':name,'start':start,'end':end} for name,start,end in [('NVSS',1,4),('DE-',6,6),('l_MajAxis',8,8),('S1.4',10,13)]]
    source=tmp_path/'source.gz';source.write_bytes(gzip.compress(b'abca - <  0.0\nabcb +\n'))
    readme=tmp_path/'ReadMe';readme.write_text('S1.4 mJy; major axis upper limit; J2000 equinox')
    with patch('measure_nvss_owned_storage.guard'):
        receipt=convert(source,readme,tmp_path/'detail.parquet',{'schema':fields,'rows':2,'source_sha256':'fixture'},0)
    rows=pq.read_table(tmp_path/'detail.parquet').to_pylist()
    assert receipt['all_fields_verified']
    assert rows[0]=={'NVSS':'abca','DE-':'-','l_MajAxis':'<','S1.4':'0.0'}
    assert rows[1]['S1.4'] is None and rows[1]['l_MajAxis'] is None


def test_angular_rounding_signs_missing_and_duplicate_names():
    row=dict(NVSS='000000+000000a',RAh='23',RAm='59',RAs='60',DEd='0',DEm='30',DEs='0');row['DE-']='-'
    assert position(row)==(0,-0.5,'angular')
    missing=dict(row,RAh=None)
    assert position(missing)==(None,None,'unknown')
    invalid=dict(row,DEd='91')
    assert position(invalid)==(None,None,'invalid')
    db=sqlite3.connect(':memory:')
    db.execute('CREATE TABLE objects(ordinal INTEGER PRIMARY KEY,name TEXT,ra REAL,dec REAL,row_group INTEGER,row_offset INTEGER)')
    db.execute('CREATE VIRTUAL TABLE angular USING rtree(ordinal,min_ra,max_ra,min_dec,max_dec)')
    with db:assert add_group(db,[row,missing,invalid],0)==(3,1,1,1)
    assert db.execute('SELECT count(*) FROM objects').fetchone()==(3,)
    assert db.execute('SELECT name FROM objects WHERE ordinal=1').fetchone()==('NVSS J000000+000000a',)
