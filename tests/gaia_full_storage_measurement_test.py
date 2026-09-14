import gzip
import hashlib
import importlib.util
from pathlib import Path
import sys

import pytest
pytest.importorskip('pyarrow')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import measure_gaia_full_partitions as measurement


def fixture_source(path):
    fields=[('source_id','int64'),('designation','string'),('parallax','float64')]
    fields += [(f'value_{n}','float32' if n==0 else 'float64') for n in range(149)]
    header='# %ECSV 1.0\n# ---\n# datatype:\n'
    header+=''.join(f'# - {{name: {name}, datatype: {kind}}}\n' for name,kind in fields)
    header+=','.join(x[0] for x in fields)+'\n'
    header+=','.join(['9007199254740993','Gaia DR3 9007199254740993','-0.125']+['null']*149)+'\n'
    header+=','.join(['9007199254740994','Gaia DR3 9007199254740994','0']+['1.23456789012345']*149)+'\n'
    with gzip.open(path,'wt') as stream:stream.write(header)
    return hashlib.md5(path.read_bytes()).hexdigest()


def test_complete_partition_checks_ids_all_fields_and_corruption(tmp_path):
    source=tmp_path/'source.csv.gz';md5=fixture_source(source)
    result=measurement.measure(source,tmp_path/'out.parquet',md5,tmp_path,0)
    assert result['rows']==2 and result['columns']==152
    assert result['min_source_id']=='9007199254740993'
    assert result['all_field_roundtrip_verified']
    assert result['source_bytes']==source.stat().st_size
    assert result['parquet_bytes']==(tmp_path/'out.parquet').stat().st_size
    with pytest.raises(ValueError,match='MD5 mismatch'):
        measurement.measure(source,tmp_path/'bad.parquet','0'*32,tmp_path,0)
    assert not (tmp_path/'bad.parquet').exists()


def test_projection_keeps_ids_nulls_and_negative_parallax(tmp_path, monkeypatch):
    source=tmp_path/'source.csv.gz';fixture_source(source)
    monkeypatch.setattr(measurement,'BUILD_COLUMNS',('source_id','designation','parallax','value_0'))
    result=measurement.build_projection(source,tmp_path/'projection.parquet',2,tmp_path,0)
    import pyarrow.parquet as pq
    rows=pq.read_table(tmp_path/'projection.parquet').to_pylist()
    assert rows[0]['source_id']==9007199254740993
    assert rows[0]['parallax']==-0.125 and rows[0]['value_0'] is None
    assert rows[1]['parallax']==0
    assert str(pq.read_schema(tmp_path/'projection.parquet').field('value_0').type)=='float'
    assert result['rows']==2
    assert result['bytes']==(tmp_path/'projection.parquet').stat().st_size
    with pytest.raises(ValueError,match='row mismatch'):
        measurement.build_projection(source,tmp_path/'bad-projection.parquet',3,tmp_path,0)
    assert not (tmp_path/'bad-projection.parquet').exists()
