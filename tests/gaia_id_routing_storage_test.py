import json
from pathlib import Path
import sqlite3
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_gaia_id_routing import build


def test_partial_routing_is_resumable_and_rejects_overlapping_sources(tmp_path):
    names=[f'GaiaSource_{n:06d}-{n:06d}.csv.gz' for n in range(3386)]
    (tmp_path/'manifest.txt').write_text(''.join('0'*32+'  '+n+'\n' for n in names))
    (tmp_path/'receipts').mkdir()
    receipt={'all_field_roundtrip_verified':True,'source_file':names[0],
             'parquet_sha256':'1'*64,'rows':2,'parquet_bytes':100,
             'row_groups':[{'min_id':'9007199254740993','max_id':'9007199254740996','rows':2}]}
    (tmp_path/'receipts'/(names[0]+'.json')).write_text(json.dumps(receipt))
    out=tmp_path/'routing.sqlite'
    first=build(tmp_path,out);second=build(tmp_path,out)
    assert first['status']=='INCOMPLETE' and first['full_serving_total'] is None
    assert first['sha256']==second['sha256']
    with sqlite3.connect(out) as db:
        assert db.execute('SELECT min_id FROM groups').fetchone()[0]==9007199254740993
    receipt['source_file']=names[1]
    receipt['row_groups'][0]['min_id']='9007199254740994'
    (tmp_path/'receipts'/(names[1]+'.json')).write_text(json.dumps(receipt))
    with pytest.raises(ValueError,match='overlapping global'):build(tmp_path,out)
    with sqlite3.connect(out) as db:
        assert db.execute('SELECT count(*) FROM files').fetchone()[0]==1
