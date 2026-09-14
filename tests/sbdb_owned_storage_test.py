import json
from pathlib import Path
import sqlite3
import sys
import pyarrow.parquet as pq

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_sbdb_owned_storage import convert,index_category
from measure_gaia_full_partitions import sha


def test_decimal_precision_nulls_names_and_offline_locator(tmp_path):
    fields=['spkid','full_name','pdes','name','diameter','sigma_e']
    rows=[[9007199254740993,'Object A','A',None,None,'0.0000000000000000123456789'],
          [9007199254740994,'Object B','B','Same name','0','1.2300e-19']]
    source=tmp_path/'source.json';source.write_text(json.dumps({'fields':fields,'count':2,'data':rows}))
    output=tmp_path/'data.parquet'
    receipt={'fields':fields,'rows':2,'sha256':sha(source)}
    stored=convert(source,output,receipt,b'{"units":"original"}',0)
    assert stored['all_fields_verified'] and stored['rows']==2
    assert [list(r.values()) for r in pq.read_table(output).to_pylist()]==rows
    db=sqlite3.connect(':memory:')
    db.executescript('CREATE TABLE objects(spkid INTEGER PRIMARY KEY,category TEXT,row_group INTEGER,row_offset INTEGER); CREATE TABLE aliases(alias TEXT,spkid INTEGER,field TEXT,PRIMARY KEY(alias,spkid,field));')
    with db:assert index_category(db,output,'an')==(2,5)
    key,group,offset=db.execute('SELECT spkid,row_group,row_offset FROM objects WHERE spkid=?',(2**53+1,)).fetchone()
    record=pq.ParquetFile(output).read_row_group(group).to_pylist()[offset]
    assert record['spkid']==key and record['diameter'] is None
