import hashlib
import io
import json
from pathlib import Path
import sys
from unittest.mock import patch
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from download_catalog_ranges import fetch


class Response(io.BytesIO):
    def __init__(self, data=b'', status=200, extra=None):
        super().__init__(data)
        self.status=status
        self.headers={'ETag':'"release-1"', 'Last-Modified':'Tue, 19 May 2026 10:55:08 GMT',
                      'Accept-Ranges':'bytes', 'Content-Length':'10', **(extra or {})}


def test_resume_recycles_only_uncommitted_tail_and_verifies_source(tmp_path):
    calls=[]
    def open_request(request, **kwargs):
        if request.get_method()=='HEAD':return Response()
        start,end=map(int,request.headers['Range'].removeprefix('bytes=').split('-'))
        calls.append((start,end))
        return Response(b'0123456789'[start:end+1],206,{'Content-Range':f'bytes {start}-{end}/10'})
    options=dict(chunk_bytes=4,bytes_per_second=10**9,min_free_bytes=0)
    with patch('download_catalog_ranges.urllib.request.urlopen',open_request):
        assert fetch('https://example.test/source',tmp_path,max_chunks=1,**options)['bytes']==4
        with (tmp_path/'source.partial').open('ab') as f:f.write(b'uncommitted')
        receipt=fetch('https://example.test/source',tmp_path,**options)
        assert calls==[(0,3),(4,7),(8,9)]
        assert receipt['sha256']==hashlib.sha256(b'0123456789').hexdigest()
        assert (tmp_path/'source.bin').read_bytes()==b'0123456789'
        assert receipt['rows'] is None
        fetch('https://example.test/source',tmp_path,**options)
        assert len(calls)==3
        (tmp_path/'source.bin').write_bytes(b'X123456789')
        with pytest.raises(ValueError,match='checkpoint bytes changed'):
            fetch('https://example.test/source',tmp_path,**options)


def test_rejects_ignored_range_without_admitting_source(tmp_path):
    with patch('download_catalog_ranges.urllib.request.urlopen',lambda *a,**k:Response(b'0123456789')):
        with pytest.raises(ValueError,match='ignored range'):
            fetch('https://example.test/source',tmp_path,chunk_bytes=4,min_free_bytes=0)
    assert not (tmp_path/'receipt.json').exists()
    assert not (tmp_path/'source.partial').exists()
