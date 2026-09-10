from pathlib import Path
import sys
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_allwise_full_partitions import measure,COLUMNS


def test_all_columns_null_nan_flags_and_lossless_ids(tmp_path):
    values={n:pa.array([None,0.0,float('nan')],type=pa.float64()) for n in COLUMNS}
    for n in ['cntr','ext_flg','n_2mass','tmass_key']:values[n]=pa.array([2**53+1,None,0],type=pa.int64())
    for n in ['designation','ph_qual','cc_flags']:values[n]=pa.array(['001ABC',None,'0000'])
    values.update({f'scientific_{n}':pa.array(['1.00000000000000000001',None,'0']) for n in range(285)})
    table=pa.table(values).replace_schema_metadata({b'provider':b'pinned scientific schema'})
    source=tmp_path/'source.parquet';pq.write_table(table,source)
    detail=tmp_path/'detail.parquet';projection=tmp_path/'projection.parquet'
    measure(source,detail,projection,3)
    assert pq.read_table(detail).schema.metadata==table.schema.metadata
    assert pq.read_table(projection)['cntr'].to_pylist()==[2**53+1,None,0]
    assert pq.read_table(detail)['scientific_284'].to_pylist()==['1.00000000000000000001',None,'0']
    with pytest.raises(ValueError,match='drift'):measure(source,detail,projection,4)
