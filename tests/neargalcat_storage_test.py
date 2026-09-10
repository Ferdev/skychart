from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from measure_neargalcat_storage import rows


def test_tdat_null_zero_precision_names_and_boundaries():
    doc='line[1] = name distance flag\n<DATA>\nA B|0|<|\nC||?|\n<END>\n'
    header,result=rows(doc,['name','distance','flag'])
    assert result==[{'name':'A B','distance':'0','flag':'<'},{'name':'C','distance':None,'flag':'?'}]
    for malformed in [doc.replace('<END>',''),doc.replace('C||?|','C|?|'),doc.replace('name distance flag','name flag distance')]:
        with pytest.raises(ValueError):rows(malformed,['name','distance','flag'])
