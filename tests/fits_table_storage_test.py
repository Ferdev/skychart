from pathlib import Path
import sys
import numpy as np
import pyarrow.parquet as pq
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_fits_table_storage import arrow_table,verify_batch


def test_endian_ids_arrays_nan_sentinels_and_headers_roundtrip(tmp_path):
    batch=np.zeros(2,dtype=[('id','>i8'),('flags','u1',(69,)),('photometry','>f4',(2,3)),('name','U8'),('null_marker','>i4'),('agn_color','?')])
    batch['id']=[9007199254740993,9223372036854775807]
    batch['flags'][0,68]=255;batch['photometry'][1,1,2]=np.nan
    batch['name']=['A','B'];batch['null_marker'][1]=-2147483648
    batch['agn_color']=[False,True]
    metadata={b'fits_header':b'TNULL5 = -2147483648; TDIM3 = (3,2)'}
    table=arrow_table(batch,metadata);path=tmp_path/'rows.parquet'
    pq.write_table(table,path,compression='zstd')
    restored=pq.read_table(path)
    assert restored.schema.metadata==metadata
    verify_batch(batch,restored)
    assert restored['agn_color'].to_pylist()==[False,True]
    wrong=batch.copy();wrong['flags'][0,68]=0
    with pytest.raises(ValueError,match='flags'):verify_batch(wrong,restored)
    with pytest.raises(ValueError,match='unsupported FITS field dtype'):
        arrow_table(np.zeros(1,dtype=[('variable',object)]),{})
