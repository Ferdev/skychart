import csv
import hashlib
from pathlib import Path
import sys
from unittest.mock import patch
import pyarrow.parquet as pq
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_openngc_owned_storage import measure


def test_full_fields_empty_zero_and_offline_routing(tmp_path):
    source=tmp_path/'source.csv';guide=tmp_path/'guide.txt';guide.write_text('Pinned units and flags')
    rows=[{'Name':'IC0001','Type':'NonEx','RA':'','Pax':'0','Notes':'é; retained'},
          {'Name':'NGC0001','Type':'Dup','RA':'00:00:00.0','Pax':'','Notes':'duplicate remains a source record'}]
    with source.open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]),delimiter=';');w.writeheader();w.writerows(rows)
    contract={'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'rows':2,'columns':list(rows[0]),'release_commit':'fixture'}
    with patch('measure_openngc_owned_storage.guard'):
        result=measure(source,guide,tmp_path/'output',contract)
        assert measure(source,guide,tmp_path/'output',contract)==result
    assert result['offline_hydrations_verified']==2
    assert result['full_serving_bytes'] is None
    assert pq.read_table(tmp_path/'output/detail.parquet').to_pylist()==rows
