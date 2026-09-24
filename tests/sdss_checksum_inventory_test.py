from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from inventory_sdss_checksums import parse


def test_complete_manifest_paths_match_listing():
    raw=('a'*40+'  ./1/photoObj-001000-1-0027.fits\n'+'b'*40+'  photoRun-001000.fits\n').encode()
    assert len(parse(raw,{'1/photoObj-001000-1-0027.fits','photoRun-001000.fits'}))==2


@pytest.mark.parametrize('raw',[
    b'invalid\n',
    ('a'*40+'  ../outside\n').encode(),
    ('a'*40+'  file\n'+'b'*40+'  ./file\n').encode(),
    b'',
])
def test_reject_malformed_unlisted_duplicate_or_truncated_manifest(raw):
    with pytest.raises(ValueError):parse(raw,{'file'})
