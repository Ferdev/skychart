from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from packed_catalog_id_lookup import write_run,locator,read_run
from build_allwise_packed_full import describe,merge_stage


def test_interrupted_merge_resumes_without_deleting_uncommitted_inputs(tmp_path):
    inputs=[]
    for i,key in enumerate([9,1,7,3]):
        p=tmp_path/f's000-{i:05d}.scid'
        write_run(p,[(key,locator(i,0,0))]);inputs.append(describe(p,1))
    calls=0
    def interrupt():
        nonlocal calls
        calls+=1
        if calls==2:raise RuntimeError('interrupted')
    with pytest.raises(RuntimeError):merge_stage(tmp_path,inputs,1,interrupt,fan_in=2)
    assert all((tmp_path/r['file']).exists() for r in inputs)
    assert not (tmp_path/'stage-001.json').exists()
    outputs=merge_stage(tmp_path,inputs,1,lambda:None,fan_in=2)
    assert (tmp_path/'stage-001.json').exists()
    assert not any((tmp_path/r['file']).exists() for r in inputs)
    final=merge_stage(tmp_path,outputs,2,lambda:None,fan_in=2)
    assert [key for key,_ in read_run(tmp_path/final[0]['file'])]==[1,3,7,9]
