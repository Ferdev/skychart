import gzip
from pathlib import Path
import sys
import pytest
pa=pytest.importorskip('pyarrow')
import pyarrow.parquet as pq
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_psc_full_partitions import schema_from,measure


def test_full_psc_fields_nulls_identifiers_and_source_sums(tmp_path):
    path=Path(__file__).parent/'fixtures/psc-schema.sql'
    schema=schema_from(path)
    values={f.name:'0.125' if pa.types.is_floating(f.type) else '0' if pa.types.is_integer(f.type) else '\\N' for f in schema}
    values.update(ra='0',decl='0',pts_key='1234567890',designation='00000000+0000000',j_m='\\N',h_m='0',ph_qual='UAA',rd_flg='012')
    source=tmp_path/'source.gz'
    with gzip.open(source,'wt') as f:f.write('|'.join(values[n] for n in schema.names)+'\n')
    result=measure(source,path,tmp_path/'detail.parquet',tmp_path/'projection.parquet',tmp_path,0)
    assert result['rows']==1 and result['columns']==60
    assert result['integer_verification_sums']['pts_key']==1234567890
    assert result['all_fields_verified'] and result['full_gzip_crc_verified']
    row=pq.read_table(tmp_path/'detail.parquet').to_pylist()[0]
    assert row['j_m'] is None and row['h_m']==0
    assert row['designation']=='00000000+0000000' and row['rd_flg']=='012'
    assert row['ra']==0 and row['decl']==0
    with gzip.open(tmp_path/'bad.gz','wt') as f:f.write('1|2|3\n')
    with pytest.raises(pa.ArrowInvalid):
        measure(tmp_path/'bad.gz',path,tmp_path/'bad.parquet',tmp_path/'bad-proj.parquet',tmp_path,0)
