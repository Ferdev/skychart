from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_atnf_storage import split_records


def test_exact_record_bytes_keep_comments_uncertainties_and_aliases():
    raw=b'#header\nPSRJ J1234+5678 ref\n# uncertainty comment\nPX -0.2 3 ref\nPSRB B1234+56\n@---\nPSRJ J2345+6789 ref\nDM 0 1 ref\n@---\n'
    header,rows=split_records(raw)
    assert header+b''.join(r[2] for r in rows)==raw
    assert rows[0][1]=='B1234+56' and rows[1][1] is None
    assert rows[0][3]['PX']==1
    with pytest.raises(ValueError,match='unterminated'):split_records(raw+b'PSRJ J3456+7890\n')
    with pytest.raises(ValueError,match='duplicate'):split_records(raw+rows[0][2])
