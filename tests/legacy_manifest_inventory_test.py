import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from inventory_legacy_tractor import parse


def test_provider_checksums_preserve_exact_brick_names():
    raw = ('a'*64 + '  tractor-0001m025.fits\n' + 'b'*64 + ' *tractor-0002p010.fits\n').encode()
    assert parse(raw, '000') == {'tractor-0001m025.fits': 'a'*64, 'tractor-0002p010.fits': 'b'*64}


@pytest.mark.parametrize('raw', [b'', b'HTML error page', ('a'*64+'  tractor-0011p010.fits').encode(),
    (('a'*64+'  tractor-0001p010.fits\n')*2).encode()])
def test_invalid_manifests_cannot_count_as_source_inventory(raw):
    with pytest.raises(ValueError):
        parse(raw, '000')
