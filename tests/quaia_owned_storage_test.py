from pathlib import Path
import sys
import sqlite3
from unittest.mock import patch
import pytest
import pyarrow.parquet as pq
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_quaia_owned_storage import convert,add_group,equal
from audit_votable_source import audit


def test_typed_roundtrip_preserves_large_ids_nulls_and_nan(tmp_path):
    source=tmp_path/'source.xml'
    source.write_text('''<VOTABLE><RESOURCE><INFO name="QUERY_STATUS" value="OK"/><TABLE>
<FIELD name="source_id" datatype="long"/><FIELD name="unwise_objid" datatype="char"/><FIELD name="ra" datatype="double"/><FIELD name="dec" datatype="double"/>
<DATA><TABLEDATA><TR><TD>9007199254740993</TD><TD>same</TD><TD>0</TD><TD>0</TD></TR>
<TR><TD>9223372036854775807</TD><TD>same</TD><TD></TD><TD>NaN</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>''')
    receipt=audit(source,2)
    with patch('measure_quaia_owned_storage.guard'):
        result=convert(source,tmp_path/'detail.parquet',receipt,0)
    rows=pq.read_table(tmp_path/'detail.parquet').to_pylist()
    assert result['all_fields_verified']
    assert rows[0]['source_id']==9007199254740993
    assert rows[1]['source_id']==9223372036854775807
    assert rows[1]['ra'] is None
    assert equal(rows[1],dict(rows[1]))
    db=sqlite3.connect(':memory:')
    db.execute('CREATE TABLE objects(source_id INTEGER PRIMARY KEY,unwise_objid TEXT,ra REAL,dec REAL,row_group INTEGER,row_offset INTEGER)')
    db.execute('CREATE VIRTUAL TABLE angular USING rtree(source_id,min_ra,max_ra,min_dec,max_dec)')
    with db:assert add_group(db,rows,0)==(2,1)
    assert db.execute('SELECT count(*) FROM objects WHERE unwise_objid=?',('same',)).fetchone()==(2,)
    assert db.execute('SELECT source_id FROM angular').fetchone()==(9007199254740993,)
    with pytest.raises(sqlite3.IntegrityError):
        with db:add_group(db,[rows[0]],1)
    assert db.execute('SELECT count(*) FROM objects').fetchone()==(2,)
