"""Bounded, allowlisted raster decoding in a separate OS process."""
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import struct

LIMIT = 768 * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (LIMIT, LIMIT))
resource.setrlimit(resource.RLIMIT_CPU, (90, 90))
resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024 * 1024, 512 * 1024 * 1024))
os.environ.update(VIPS_CONCURRENCY='1', VIPS_BLOCK_UNTRUSTED='1', VIPS_DISC_THRESHOLD='32m')

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=40).stdout.decode().strip()

def clean_png(path):
    # Some libvips versions retain arbitrary PNG text even with [strip]. Keep
    # only pixels, transparency, and standard colour fields in generated files.
    allowed = {b'IHDR', b'PLTE', b'IDAT', b'IEND', b'tRNS', b'sRGB', b'gAMA', b'cHRM'}
    clean = path.with_suffix('.clean.png')
    with path.open('rb') as source, clean.open('wb') as target:
        signature = source.read(8)
        if signature != b'\x89PNG\r\n\x1a\n':
            raise ValueError('Invalid generated PNG')
        target.write(signature)
        while True:
            header = source.read(8)
            if len(header) != 8:
                raise ValueError('Truncated generated PNG')
            size, kind = struct.unpack('>I4s', header)
            keep = kind in allowed
            if keep:
                target.write(header)
            remaining = size + 4
            while remaining:
                block = source.read(min(remaining, 65536))
                if not block:
                    raise ValueError('Truncated generated PNG')
                if keep:
                    target.write(block)
                remaining -= len(block)
            if kind == b'IEND':
                break
    clean.replace(path)

def process(source, output):
    data = source.read_bytes()
    if not 0 < len(data) <= 60_000_000:
        raise ValueError('File size exceeds the upload limit')
    suffix = '.jpg' if data[:3] == b'\xff\xd8\xff' else '.png' if data[:8] == b'\x89PNG\r\n\x1a\n' else '.tif' if data[:4] in (b'II*\0', b'MM\0*') else None
    if suffix is None:
        raise ValueError('Use JPEG, PNG, or TIFF')
    output.mkdir(parents=True, exist_ok=True)
    input_path = output / ('input' + suffix)
    input_path.write_bytes(data)
    width = int(run('vipsheader', '-f', 'width', str(input_path)))
    height = int(run('vipsheader', '-f', 'height', str(input_path)))
    if width <= 0 or height <= 0 or width * height > 120_000_000:
        raise ValueError('Image exceeds 120 megapixels')
    pages = subprocess.run(['vipsheader','-f','n-pages',str(input_path)], capture_output=True, timeout=10)
    if pages.returncode == 0 and int(pages.stdout) > 1:
        raise ValueError('Use a single-frame image')
    # Thumbnail performs autorotation and profile conversion without enlarging.
    run('vips', 'thumbnail', str(input_path), str(output / 'master.png') + '[strip]', str(max(width,height)), '--height', str(max(width,height)), '--size', 'down', '--export-profile', 'srgb', '--fail-on', 'error')
    clean_png(output / 'master.png')
    for size in (96, 320, 1600):
        run('vips', 'thumbnail', str(output / 'master.png'), str(output / f'{size}.webp') + '[strip,Q=85]', str(size), '--height', str(size), '--size', 'down', '--fail-on', 'error')
    # A small luminance average hash helps moderators find visually similar copies.
    # It is a review signal, not proof of ownership or an automatic rejection.
    run('vips', 'thumbnail', str(output / 'master.png'), str(output / 'hash.png'), '8', '--height', '8', '--size', 'force')
    run('vips', 'flatten', str(output / 'hash.png'), str(output / 'rgb.png'))
    run('vips', 'cast', str(output / 'rgb.png'), str(output / 'rgb8.png'), 'uchar', '--shift')
    run('vips', 'rawsave', str(output / 'rgb8.png'), str(output / 'rgb.raw'))
    bands = int(run('vipsheader','-f','bands',str(output/'rgb8.png')))
    pixels = (output/'rgb.raw').read_bytes()
    rgb = [tuple(pixels[i:i+bands]) for i in range(0,len(pixels),bands)]
    luminance = [sum(p[:3])/min(3,bands) for p in rgb]
    average = sum(luminance)/len(luminance)
    bits = sum((1 << i) for i,value in enumerate(luminance) if value >= average)
    color = [round(sum(p[min(channel,bands-1)] for p in rgb)/len(rgb)) for channel in range(3)]
    dominant = '#'+''.join(f'{c:02x}' for c in color)
    for file in ('hash.png','rgb.png','rgb8.png','rgb.raw'):
        (output/file).unlink()
    input_path.unlink()
    width = int(run('vipsheader','-f','width',str(output/'master.png')))
    height = int(run('vipsheader','-f','height',str(output/'master.png')))
    return {'sha256': hashlib.sha256(data).hexdigest(), 'perceptual_hash':f'{bits:016x}', 'dominant_color':dominant, 'width': width, 'height': height}

if __name__ == '__main__':
    try:
        print(json.dumps(process(Path(sys.argv[1]), Path(sys.argv[2]))))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)[:200]}))
        sys.exit(1)
