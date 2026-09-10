import gzip
import hashlib
from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from audit_compressed_fits_source import unpack


def test_crc_and_whole_blocks_required_before_replacing_output(tmp_path):
    source=tmp_path/'source.gz';output=tmp_path/'source.fits'
    payload=b' '*2880
    raw=gzip.compress(payload,mtime=0);source.write_bytes(raw)
    r=unpack(source,output,hashlib.sha256(raw).hexdigest(),0)
    assert r['decompressed_bytes']==2880
    assert output.read_bytes()==payload
    broken=raw[:-4];source.write_bytes(broken)
    with pytest.raises((EOFError,OSError)):
        unpack(source,output,hashlib.sha256(broken).hexdigest(),0)
    assert output.read_bytes()==payload
    short=gzip.compress(b'incomplete block',mtime=0);source.write_bytes(short)
    with pytest.raises(ValueError,match='FITS blocks'):
        unpack(source,output,hashlib.sha256(short).hexdigest(),0)
    assert output.read_bytes()==payload
