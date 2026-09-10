from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_openngc_evidence_index import angle,references


def test_unknown_zero_and_polar_angles():
    assert angle('') is None
    assert angle('00:00:00',True)==0
    assert angle('-00:30:00')==-0.5
    assert angle('+90:00:00')==90
    assert angle('24:00:00',True)==0
    for value in ['24:00:01','-01:00:00','12:60:00','nan:00:00']:
        with pytest.raises(ValueError):angle(value,True)
    with pytest.raises(ValueError):angle('90:00:01')


def test_central_star_not_parent_alias_and_reference_provenance():
    row={'M':'031','NGC':'0224','IC':'','Identifiers':'PGC 002557','Common names':'Andromeda','Cstar Names':'HD 123'}
    entries=list(references(row))
    assert ('HD 123','Cstar Names','central_star') in entries
    assert ('HD 123','Cstar Names','published_name_evidence') not in entries
    assert ('M031','M','published_name_evidence') in entries
    assert ('NGC0224','NGC','published_name_evidence') in entries
