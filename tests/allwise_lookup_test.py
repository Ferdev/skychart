from pathlib import Path
import sqlite3
import sys
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_allwise_lookup import insert_partition


def test_lossless_ids_nonunique_names_locators_and_rollback(tmp_path):
    p=tmp_path/'projection.parquet'
    pq.write_table(pa.table({'cntr':pa.array([2**53+1,2],type=pa.int64()),'designation':['same','same']}),p,row_group_size=1)
    db=sqlite3.connect(':memory:')
    db.execute('CREATE TABLE objects(cntr INTEGER PRIMARY KEY,designation TEXT,file_id INTEGER,row_group INTEGER,row_offset INTEGER)')
    with db:assert insert_partition(db,p,7)==2
    assert db.execute('SELECT file_id,row_group,row_offset FROM objects WHERE cntr=?',(2**53+1,)).fetchone()==(7,0,0)
    assert db.execute('SELECT count(*) FROM objects WHERE designation=?',('same',)).fetchone()[0]==2
    pq.write_table(pa.table({'cntr':[3,2],'designation':['new','duplicate']}),p)
    with pytest.raises(sqlite3.IntegrityError):
        with db:insert_partition(db,p,8)
    assert db.execute('SELECT count(*) FROM objects').fetchone()[0]==2
