from pathlib import Path
import sys,json
import pyarrow.parquet as pq
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import measure_votable_storage as module


def test_native_types_nan_missing_metadata_and_completed_integrity(tmp_path,monkeypatch):
    monkeypatch.setattr(module,'guard',lambda *a:None)
    source=tmp_path/'source.xml';audit=tmp_path/'audit.json';output=tmp_path/'out'
    fields=[('id','long'),('flag','int'),('distance','double'),('name','char')]
    source.write_text('<VOTABLE><RESOURCE><TABLE>'+''.join(f'<FIELD name="{n}" datatype="{t}"/>' for n,t in fields)+
      '<DATA><TABLEDATA><TR><TD>9007199254740993</TD><TD>-1</TD><TD>NaN</TD><TD>A</TD></TR>'+
      '<TR><TD>2</TD><TD>0</TD><TD></TD><TD></TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>')
    audit.write_text(json.dumps({'status':'complete_TABLEDATA_source_audited','sha256':module.sha(source),
        'rows':2,'columns':4,'fields':[{'attributes':{'name':n,'datatype':t}} for n,t in fields]}))
    r=module.measure(source,audit,output);table=pq.read_table(output/'detail.parquet')
    assert table['id'][0].as_py()==9007199254740993
    assert str(table.schema.field('flag').type)=='int32'
    assert table['flag'].to_pylist()==[-1,0] and table['distance'][1].as_py() is None
    assert module.measure(source,audit,output)==r
    with (output/'detail.parquet').open('ab') as f:f.write(b'changed')
    with pytest.raises(ValueError,match='completed detail changed'):module.measure(source,audit,output)
