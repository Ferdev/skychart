import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from packed_catalog_id_lookup import locator,write_run,read_run,merge,lookup


def test_lossless_ids_merge_exact_membership_and_failures(tmp_path):
    a=tmp_path/'a';b=tmp_path/'b';output=tmp_path/'all'
    write_run(a,[(0,locator(0,0,0)),(2**53+1,locator(12287,31,4095))])
    write_run(b,[(9,locator(9,2,7)),(2**64-1,locator(1,0,0))])
    assert merge([a,b],output)==4
    assert lookup(output,2**53+1)==(12287,31,4095)
    assert lookup(output,2**53) is None
    assert lookup(output,0)==(0,0,0)
    prior=output.read_bytes()
    with pytest.raises(ValueError,match='duplicate'):merge([a,a],output)
    assert output.read_bytes()==prior
    with pytest.raises(ValueError,match='locator'):locator(1,32,0)
    b.write_bytes(b.read_bytes()[:-1])
    with pytest.raises(ValueError,match='truncated'):list(read_run(b))
