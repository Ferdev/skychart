from pathlib import Path
import sys
import json
import pytest
import pyarrow.parquet as pq
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import measure_cds_table_storage as module
from audit_cds_fixed_width import audit


def test_precision_nulls_flags_metadata_and_resume(tmp_path,monkeypatch):
    monkeypatch.setattr(module,'guard',lambda *a:None)
    source=tmp_path/'values.dat';readme=tmp_path/'ReadMe';receipt=tmp_path/'audit.json'
    readme.write_text('Byte-by-byte Description of file: values.dat\n 1-16 I16 --- ID Identifier\n 18-22 F5.2 mas Plx Parallax\n 24 A1 --- Flag Candidate\n')
    source.write_bytes(b'9007199254740993 -0.10 ? \n0000000000000001  0.00   \n0000000000000002         \n')
    receipt.write_text(json.dumps(audit(source,readme,'values.dat',3,module.sha(source),record_width=25)))
    output=tmp_path/'output';r=module.measure(source,readme,receipt,output)
    assert r['rows']==3 and r['columns']==3 and r['all_fields_verified']
    table=pq.read_table(output/'detail.parquet')
    assert table['Plx'].to_pylist()==['-0.10','0.00',None]
    assert table['ID'][0].as_py()=='9007199254740993'
    assert table['Flag'].to_pylist()==['?',None,None]
    assert table.schema.metadata[b'source_readme']==readme.read_bytes()
    assert module.measure(source,readme,receipt,output)==r
    with (output/'detail.parquet').open('ab') as f:f.write(b'x')
    with pytest.raises(ValueError,match='completed detail changed'):module.measure(source,readme,receipt,output)
