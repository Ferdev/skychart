from pathlib import Path
import sys,gzip
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import measure_6df_catalog as module
from audit_cds_fixed_width import schema


def test_unnamed_delimiters_preserved_by_byte_position(tmp_path):
    p=tmp_path/'ReadMe';p.write_text('Byte-by-byte Description of file: s.dat\n 1 A1 --- --- [:]\n 2 I1 --- ID Identifier\n 3 A1 --- --- [:]\n')
    fields=schema(p,'s.dat')
    assert [f['name'] for f in fields]==['_unnamed_byte_1','ID','_unnamed_byte_3']
    assert fields[0]['source_name']=='---'


def test_truncated_gzip_never_replaces_valid_expansion(tmp_path,monkeypatch):
    monkeypatch.setattr(module,'guard',lambda *args:None)
    source=tmp_path/'source.gz';output=tmp_path/'source.dat';source.write_bytes(gzip.compress(b'full rows\n'))
    receipt={'sha256':module.sha(source),'uncompressed_bytes':10}
    assert module.expand(source,output,receipt)['gzip_crc_verified']
    source.write_bytes(source.read_bytes()[:-4]);receipt['sha256']=module.sha(source)
    with pytest.raises((EOFError,OSError)):module.expand(source,output,receipt)
    assert output.read_bytes()==b'full rows\n'
