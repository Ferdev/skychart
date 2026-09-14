from pathlib import Path
import sys
import pyarrow as pa
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_fits_exact_lookup import entries,key


def test_partition_routing_preserves_repeated_ids_and_resumes(tmp_path,monkeypatch):
    import json
    import sqlite3
    import pyarrow.parquet as pq
    import measure_fits_exact_lookup as module
    source=tmp_path/'source';source.mkdir();parts=[]
    for start,stop in [(0,2),(2,3)]:
        path=source/f'part-{start}.parquet'
        pq.write_table(pa.table({'id':[9007199254740993]*(stop-start),'name':['001']*(stop-start)}),path,row_group_size=1)
        parts.append({'hdu':1,'source_start':start,'source_stop':stop,'file':path.name,'rows':stop-start,
                      'all_fields_verified':True,'sha256':module.sha(path)})
    audit={'status':'FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED','rows':3,'expected_rows':3,
           'source_sha256':'pinned-source','partitions':list(reversed(parts))}
    (source/'measurement.json').write_text(json.dumps(audit))
    calls=0
    def interrupted(*args):
        nonlocal calls
        calls+=1
        if calls==2:raise RuntimeError('interrupted after first committed group')
    monkeypatch.setattr(module,'guard',interrupted)
    output=tmp_path/'lookup'
    with pytest.raises(RuntimeError,match='interrupted'):
        module.measure(source,output,['id','name'])
    assert not (output/'measurement.json').exists()
    monkeypatch.setattr(module,'guard',lambda *args:None)
    result=module.measure(source,output,['id','name'])
    assert result['rows']==3 and result['entries']==6
    routing_path=output/'partition-routing.json';routing=json.loads(routing_path.read_text())
    assert [(s['slot'],s['source_hdu'],s['source_start']) for s in routing['slots']]==[(0,1,0),(1,1,2)]
    with sqlite3.connect(output/'lookup.sqlite') as db:
        locators=db.execute("SELECT hdu,rg,off FROM lookup WHERE field='id' AND value='i:9007199254740993' ORDER BY hdu,rg,off").fetchall()
    assert len(locators)==3
    source_rows=[]
    for slot,group,offset in locators:
        route=routing['slots'][slot];table=pq.ParquetFile(source/route['file'])
        row=table.read_row_group(group).to_pylist()[offset]
        assert row=={'id':9007199254740993,'name':'001'}
        source_rows.append(route['source_start']+sum(table.metadata.row_group(i).num_rows for i in range(group))+offset)
    assert source_rows==[0,1,2]
    assert result['routing_bytes']==routing_path.stat().st_size
    assert result['index_and_routing_bytes']==result['bytes']+result['routing_bytes']
    assert module.measure(source,output,['id','name'])==result
    routing['slots'][0]['source_start']=1;routing_path.write_text(json.dumps(routing))
    with pytest.raises(ValueError,match='partition routing changed'):
        module.measure(source,output,['id','name'])


@pytest.mark.parametrize('change',['gap','overlap','duplicate_file','count','empty_then_nonempty'])
def test_partition_routing_rejects_invalid_accounting(change):
    from measure_fits_exact_lookup import detail_tables
    parts=[{'hdu':1,'source_start':0,'source_stop':2,'rows':2,'file':'a'},
           {'hdu':1,'source_start':2,'source_stop':3,'rows':1,'file':'b'}]
    if change=='gap':parts[1].update(source_start=3,source_stop=4)
    if change=='overlap':parts[1].update(source_start=1,source_stop=2)
    if change=='duplicate_file':parts[1]['file']='a'
    if change=='empty_then_nonempty':
        parts[0].update(source_stop=0,rows=0)
        parts[1].update(source_start=0,source_stop=3,rows=3)
    audit={'status':'FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED','partitions':parts,'rows':3,'expected_rows':4 if change=='count' else 3}
    with pytest.raises(ValueError,match='partition routing'):detail_tables(audit)


def test_exact_values_preserve_types_precision_duplicate_locators_and_nulls():
    batch=pa.table({'id':[9007199254740993,9007199254740993,None], 'name':['001','001','']})
    actual=list(entries(batch,['id','name'],1,4))
    assert actual==[('id','i:9007199254740993',1,4,0),('name','s:001',1,4,0),
                    ('id','i:9007199254740993',1,4,1),('name','s:001',1,4,1),('name','s:',1,4,2)]
    assert key(-9223372036854775808)=='i:-9223372036854775808'
    for unsupported in [1.5,True,[1]]:
        with pytest.raises(ValueError):key(unsupported)


def test_full_lookup_resume_and_changed_detail_rejected(tmp_path,monkeypatch):
    import json
    import sqlite3
    import pyarrow.parquet as pq
    import measure_fits_exact_lookup as module
    monkeypatch.setattr(module,'guard',lambda *args:None)
    source=tmp_path/'source';source.mkdir();path=source/'hdu-001.parquet'
    pq.write_table(pa.table({'id':[4,4,9],'name':['A','A',None]}),path,row_group_size=1)
    (source/'measurement.json').write_text(json.dumps({'status':'FULL_FITS_TABLE_DATA_COMPONENT_MEASURED',
        'tables':[{'hdu':1,'file':path.name,'rows':3,'all_fields_verified':True,'sha256':module.sha(path)}]}))
    output=tmp_path/'lookup';result=module.measure(source,output,['id','name'])
    assert result['rows']==3 and result['entries']==5 and result['all_locators_verified']
    assert module.measure(source,output,['id','name'])==result
    # Simulate interruption after committed groups but before final receipt.
    (output/'measurement.json').unlink()
    resumed=module.measure(source,output,['id','name'])
    assert resumed['sha256']==result['sha256']
    with sqlite3.connect(output/'lookup.sqlite') as db:
        assert db.execute("SELECT count(*) FROM lookup WHERE field='id' AND value='i:4'").fetchone()==(2,)
    with path.open('ab') as f:f.write(b'changed')
    with pytest.raises(ValueError,match='detail changed'):module.measure(source,output,['id','name'])


@pytest.mark.parametrize('status',['FULL_CDS_TABLE_DATA_COMPONENT_MEASURED','FULL_SCALAR_VOTABLE_DATA_COMPONENT_MEASURED','FULL_TDAT_TABLE_DATA_COMPONENT_MEASURED'])
def test_single_table_lookup_preserves_leading_zeros(tmp_path,monkeypatch,status):
    import json
    import sqlite3
    import pyarrow.parquet as pq
    import measure_fits_exact_lookup as module
    monkeypatch.setattr(module,'guard',lambda *args:None)
    source=tmp_path/'source';source.mkdir();path=source/'detail.parquet'
    pq.write_table(pa.table({'HIP':['0001','0002'],'HD':['9','9']}),path)
    (source/'measurement.json').write_text(json.dumps({'status':status,
        'rows':2,'all_fields_verified':True,'sha256':module.sha(path)}))
    output=tmp_path/'lookup';result=module.measure(source,output,['HIP','HD'])
    assert result['entries']==4 and result['all_locators_verified']
    with sqlite3.connect(output/'lookup.sqlite') as db:
        assert db.execute("SELECT hdu,rg,off FROM lookup WHERE field='HIP' AND value='s:0001'").fetchall()==[(0,0,0)]
        assert db.execute("SELECT count(*) FROM lookup WHERE field='HD' AND value='s:9'").fetchone()==(2,)
