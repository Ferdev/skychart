import importlib.util
from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from inventory_sdss_photoobj import parse


def test_listing_preserves_large_sizes_and_paths():
    data=b'drwxr-xr-x         16,384 2014/03/18 02:43:59 .\n-rw-r--r-- 9,007,199,254,740,993 2013/11/01 16:38:05 1/photoObj-001000-1-0027.fits\n'
    assert parse(data)['1/photoObj-001000-1-0027.fits']['bytes']==9007199254740993


@pytest.mark.parametrize('line',[
 'rsync error: partial transfer',
 '-rw-r--r-- 1 2013/11/01 16:38:05 ../escape',
 '-rw-r--r-- 1 2013/11/01 16:38:05 /absolute',
 'drwxr-xr-x 1 2013/11/01 16:38:05 .',
])
def test_rejects_errors_unsafe_and_duplicate_paths(line):
    with pytest.raises(ValueError):
        parse(('drwxr-xr-x 1 2013/11/01 16:38:05 .\n'+line+'\n').encode())


def test_missing_root_is_not_complete_listing():
    with pytest.raises(ValueError):
        parse(b'-rw-r--r-- 1 2013/11/01 16:38:05 file\n')


def test_completed_listing_resume_is_offline_and_rejects_corruption(tmp_path,monkeypatch):
    import inventory_sdss_photoobj as module
    from types import SimpleNamespace
    root=b'drwxr-xr-x 1 2013/11/01 16:38:05 .\ndrwxr-xr-x 1 2013/11/01 16:38:05 1000\n'
    run=b'drwxr-xr-x 1 2013/11/01 16:38:05 .\n-rw-r--r-- 12 2013/11/01 16:38:05 1/photoObj-001000-1-0027.fits\n-rw-r--r-- 5 2013/11/01 16:38:05 checksums\n'
    responses=iter([root,run])
    monkeypatch.setattr(module.subprocess,'run',lambda *a,**k: SimpleNamespace(returncode=0,stdout=next(responses),stderr=b''))
    first=module.run('test-host',tmp_path)
    assert first['status']=='FULL_PROVIDER_LISTING_PINNED'
    assert first['groups']['photoObj']=={'files':1,'provider_reported_bytes':12}
    assert first['source_bytes_measured'] is None
    assert module.run('test-host',tmp_path)==first
    (tmp_path/'run-1000.txt').write_bytes(run+b'corruption')
    with pytest.raises(ValueError,match='changed accepted listing'):
        module.run('test-host',tmp_path)
