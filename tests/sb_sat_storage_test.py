import json
from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_sb_sat_storage import measure,sha,validate


def fixture():
    return {'signature':{'source':'NASA/JPL Small-Body Satellites API','version':'1.0'},'count':'2','data':[
        {'sat':{'pdes':'9007199254740993','sat_fullname':'A I','confirmed':'N'},'orbit':{'epoch':None,'e':'0','sigma_e':'0.01','frame':'EC'}},
        {'sat':{'pdes':'9007199254740993','sat_fullname':'A II','confirmed':'Y'},'phys_par':{'GM':{'value':None,'notes':'candidate'}}}]}


def test_complete_roundtrip_relationships_and_resume(tmp_path):
    source=tmp_path/'source.json';source.write_text(json.dumps(fixture()));doc=tmp_path/'doc';doc.write_text('pinned units')
    output=tmp_path/'output';result=measure(source,sha(source),doc,output)
    assert result['rows']==2 and result['lookup_entries']==4 and result['unique_primary_designations']==1
    assert [json.loads(r) for r in (output/'records.jsonl').read_text().splitlines()]==fixture()['data']
    assert measure(source,sha(source),doc,output)==result
    (output/'records.jsonl').write_text('corrupt')
    with pytest.raises(ValueError,match='changed completed artifact'):measure(source,sha(source),doc,output)


def test_rejects_count_schema_and_duplicate_keys():
    j=fixture();j['count']='3'
    with pytest.raises(ValueError,match='count mismatch'):validate(json.dumps(j))
    j=fixture();j['signature']['version']='2.0'
    with pytest.raises(ValueError,match='signature'):validate(json.dumps(j))
    with pytest.raises(ValueError,match='duplicate'):validate('{"count":1,"count":2}')


def test_missing_names_remain_retrievable_by_source_ordinal(tmp_path):
    j=fixture();j['data'][0]['sat'].pop('sat_fullname');j['data'][1]['sat']={}
    src=tmp_path/'source';src.write_text(json.dumps(j));doc=tmp_path/'doc';doc.write_text('schema')
    result=measure(src,sha(src),doc,tmp_path/'out')
    assert result['rows']==2 and result['records_missing_satellite_fullname']==2
    stored=[json.loads(line) for line in (tmp_path/'out/records.jsonl').read_text().splitlines()]
    assert stored==j['data']
