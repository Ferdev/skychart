import importlib.util
import json
from pathlib import Path
import subprocess
import os
import struct
import zlib
import pytest

ROOT = Path(__file__).resolve().parents[1]
INVALID_IMAGE_EXIT = 65

def vips(*args):
    return subprocess.run(['vips', *map(str,args)], check=True, capture_output=True, env=os.environ | {'VIPS_CONCURRENCY':'1'}, timeout=60)

def process(source, output, env=None):
    return subprocess.run(['python3', str(ROOT/'backend/community_media.py'), str(source), str(output)], capture_output=True, text=True, timeout=180, env=env)

def with_fake_vipsheader(tmp_path, script):
    tool = tmp_path/'bin/vipsheader'
    tool.parent.mkdir()
    tool.write_text('#!/bin/sh\n'+script+'\n')
    tool.chmod(0o755)
    return os.environ | {'PATH': f"{tool.parent}:{os.environ['PATH']}"}

def valid_png(path):
    vips('black', path, 32, 16, '--bands', 3)
    return path

def test_large_16_bit_tiff_keeps_resolution_and_has_bounded_derivatives(tmp_path):
    # 52.8 MB uncompressed, high-bit-depth source, close to the upload byte limit.
    source = tmp_path/'large.tif'
    vips('black', tmp_path/'base.png', 5120, 1720, '--bands', 3)
    vips('cast', tmp_path/'base.png', source, 'ushort')
    assert 50_000_000 < source.stat().st_size < 60_000_000
    result = process(source, tmp_path/'out')
    assert result.returncode == 0, result.stdout
    data = json.loads(result.stdout)
    assert (data['width'],data['height']) == (5120,1720)
    assert len(data['perceptual_hash']) == 16
    assert data['dominant_color'].startswith('#')
    for size in (96,320,1600):
        value = subprocess.check_output(['vipsheader','-f','width',str(tmp_path/f'out/{size}.webp')],text=True)
        assert int(value) <= size

def test_image_metadata_is_removed_from_master_and_derivatives(tmp_path):
    source = tmp_path/'private.png'
    vips('black', source, 64, 32, '--bands', 3)
    data = source.read_bytes()
    text = b'Description\0Private observatory GPS 10.12,20.34'
    chunk = struct.pack('>I',len(text))+b'tEXt'+text+struct.pack('>I',zlib.crc32(b'tEXt'+text))
    source.write_bytes(data[:33]+chunk+data[33:])
    assert b'Private observatory' in source.read_bytes()
    result = process(source,tmp_path/'out')
    assert result.returncode == 0, result.stdout
    for file in ('master.png','96.webp','320.webp','1600.webp'):
        assert b'Private observatory' not in (tmp_path/'out'/file).read_bytes()

def test_pixel_limit_is_checked_before_full_decode(tmp_path):
    source = tmp_path/'too-many-pixels.tif'
    vips('black', str(source)+'[compression=deflate]', 11000, 11000, '--bands', 1)
    result = process(source,tmp_path/'out')
    assert result.returncode == INVALID_IMAGE_EXIT
    assert '120 megapixels' in result.stdout
    assert not (tmp_path/'out/master.png').exists()

def test_multipage_tiff_is_rejected(tmp_path):
    source = tmp_path/'frames.tif'
    vips('black', str(source)+'[page-height=16]', 32, 32, '--bands', 3)
    result = process(source,tmp_path/'out')
    assert result.returncode == INVALID_IMAGE_EXIT
    assert 'single-frame' in result.stdout

def test_unknown_image_type_is_rejected_before_decode(tmp_path):
    source = tmp_path / 'image'
    source.write_text('<svg><script>bad()</script></svg>')
    result = subprocess.run(['python3', str(ROOT/'backend/community_media.py'), str(source), str(tmp_path/'out')], capture_output=True, text=True)
    assert result.returncode == INVALID_IMAGE_EXIT
    assert 'Use JPEG, PNG, or TIFF' in result.stdout
    assert not (tmp_path/'out/master.png').exists()

def test_corrupt_image_is_rejected_with_the_reserved_exit_code(tmp_path):
    source = tmp_path/'corrupt.png'
    source.write_bytes(b'\x89PNG\r\n\x1a\nnot a real image')
    result = process(source,tmp_path/'out')
    assert result.returncode == INVALID_IMAGE_EXIT
    assert 'cannot be decoded' in result.stdout
    assert not (tmp_path/'out/master.png').exists()

def test_truncated_image_is_rejected_with_the_reserved_exit_code(tmp_path):
    source = valid_png(tmp_path/'truncated.png')
    source.write_bytes(source.read_bytes()[:48])
    result = process(source,tmp_path/'out')
    assert result.returncode == INVALID_IMAGE_EXIT

@pytest.mark.parametrize('script', [
    'kill -9 $$',
    'echo "vips: out of memory" >&2; exit 1',
    'echo "glib: Error creating thread: Resource temporarily unavailable" >&2; exit 1',
    'echo "vips: No space left on device" >&2; exit 1',
    'echo "error while loading shared libraries: failed to map segment" >&2; exit 127',
], ids=['killed', 'memory', 'threads', 'disk', 'loader'])
def test_worker_faults_do_not_use_the_rejected_image_exit_code(tmp_path, script):
    source = valid_png(tmp_path/'valid.png')
    result = process(source,tmp_path/'out',with_fake_vipsheader(tmp_path,script))
    assert result.returncode not in (0, INVALID_IMAGE_EXIT)

def test_unreadable_upload_is_a_worker_fault(tmp_path):
    result = process(tmp_path/'missing.png',tmp_path/'out')
    assert result.returncode not in (0, INVALID_IMAGE_EXIT)

def test_solver_wcs_parser_rejects_unhandled_distortion(tmp_path):
    spec = importlib.util.spec_from_file_location('community_solve', ROOT/'backend/community_solve.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cards = {'CTYPE1': "'RA---TAN'", 'CTYPE2': "'DEC--TAN'", 'CD1_1':'0.001','CD1_2':'0.01','CD2_1':'0','CD2_2':'0.001','CRVAL1':'10','CRVAL2':'20','IMAGEW':'100','IMAGEH':'100'}
    file = tmp_path/'photo.wcs'
    file.write_bytes((''.join((f'{k:<8}= {v}').ljust(80) for k,v in cards.items())+'END'.ljust(80)).encode())
    with pytest.raises(ValueError, match='distorted'):
        mod.read_wcs(file)
