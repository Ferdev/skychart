import json
from pathlib import Path
import sqlite3
import sys

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_psc_lookup import build
from measure_gaia_full_partitions import sha


def test_lookup_resume_null_position_exact_id_and_duplicate_rollback(tmp_path):
    (tmp_path/'OWNER').write_text('SkyChart exhaustive PSC investigation 1271\n')
    names=[f'psc_a{n:02d}.gz' for n in range(92)]
    (tmp_path/'manifest.json').write_text(json.dumps({'files':[{'file':n} for n in names]}))
    (tmp_path/'receipts').mkdir();(tmp_path/'build-projections').mkdir()
    def fixture(index, ids, ras, decs):
        name=names[index];path=tmp_path/'build-projections'/(name+'.parquet')
        pq.write_table(pa.table({'pts_key':pa.array(ids,type=pa.int64()),
            'designation':['same']*len(ids),'ra':pa.array(ras,type=pa.float64()),
            'decl':pa.array(decs,type=pa.float64())}),path,row_group_size=1)
        receipt={'source_file':name,'all_fields_verified':True,'rows':len(ids),
                 'detail_sha256':'a'*64,'build_projection':{'file':path.name,'sha256':sha(path)}}
        (tmp_path/'receipts'/(name+'.json')).write_text(json.dumps(receipt))
    fixture(0,[2**53+1,2,3],[0,None,359.999],[0,None,-89.99])
    out=tmp_path/'lookup.sqlite'
    result=build(tmp_path,out,floor=0)
    assert result['rows']==3 and result['angular_rows']==2
    assert result['status']=='INCOMPLETE' and result['full_serving_bytes'] is None
    assert build(tmp_path,out,floor=0)['sha256']==result['sha256']
    with sqlite3.connect(out) as db:
        assert db.execute('SELECT file_id,row_group,row_offset FROM lookup WHERE pts_key=?',(2**53+1,)).fetchone()==(0,0,0)
        assert db.execute('SELECT ra,dec FROM lookup WHERE pts_key=2').fetchone()==(None,None)
        assert db.execute('SELECT count(*) FROM lookup WHERE designation=?',('same',)).fetchone()[0]==3
        assert db.execute('SELECT pts_key FROM angular WHERE min_ra<=0 AND max_ra>=0 AND min_dec<=0 AND max_dec>=0').fetchall()==[(2**53+1,)]
    fixture(1,[4,2],[10,11],[1,2])
    with pytest.raises(sqlite3.IntegrityError):build(tmp_path,out,floor=0)
    with sqlite3.connect(out) as db:
        assert db.execute('SELECT count(*) FROM files').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM lookup').fetchone()[0]==3
        assert db.execute('SELECT count(*) FROM angular').fetchone()[0]==2
