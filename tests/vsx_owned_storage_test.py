from pathlib import Path
import sqlite3
import sys
import pyarrow.parquet as pq
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_vsx_owned_storage import convert,add_group
from measure_gaia_full_partitions import sha


def test_unknowns_zero_position_candidate_flags_and_duplicate_rollback(tmp_path):
    readme=tmp_path/'ReadMe';source=tmp_path/'vsx.dat'
    readme.write_text('Byte-by-byte Description of file: vsx.dat\n 1- 2 I2 --- OID Identifier\n 4- 8 A5 --- Name Name\n 10-10 I1 --- V Flag\n 12-16 F5.1 deg RAdeg RA\n 18-22 F5.1 deg DEdeg Dec\n')
    source.write_text(' 1 Alpha 2   0.0   0.0\n 2 Blend 3            \n')
    output=tmp_path/'detail.parquet'
    r=convert(source,readme,output,2,sha(source),0)
    assert r['all_fields_verified']
    batch=pq.read_table(output).to_pylist()
    db=sqlite3.connect(':memory:')
    db.executescript('CREATE TABLE objects(oid INTEGER PRIMARY KEY,name TEXT,ra REAL,dec REAL,variability_flag TEXT,row_group INTEGER,row_offset INTEGER); CREATE VIRTUAL TABLE angular USING rtree(oid,min_ra,max_ra,min_dec,max_dec);')
    with db:assert add_group(db,batch,0)==(2,1)
    assert db.execute('SELECT ra,dec,variability_flag FROM objects WHERE oid=2').fetchone()==(None,None,'3')
    assert db.execute('SELECT ra,dec,variability_flag FROM objects WHERE oid=1').fetchone()==(0,0,'2')
    with pytest.raises(sqlite3.IntegrityError):
        with db:add_group(db,[dict(batch[0],OID='3'),batch[0]],1)
    assert db.execute('SELECT count(*) FROM objects').fetchone()[0]==2
