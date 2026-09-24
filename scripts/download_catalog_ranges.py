#!/usr/bin/env python3
"""Sequential, validator-pinned HTTP range acquisition in owned scratch.

Completed chunks are hashed and fsynced before checkpointing. No catalog row
or serving completeness is inferred from a successful byte download.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request
from acquire_catalog_source_manifest import save


def fetch(url, root, chunk_bytes=8 << 20, bytes_per_second=2 << 20,
          min_free_bytes=100 << 30, max_chunks=None):
    if chunk_bytes < 1 or bytes_per_second < 1:
        raise ValueError('invalid transfer limits')
    root.mkdir(parents=True, exist_ok=True)
    lock = (root/'.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    owner = root/'OWNER'
    marker = 'SkyChart isolated range acquisition 1271\n'
    if owner.exists():
        if owner.read_text() != marker:
            raise ValueError('unowned output')
    else:
        if any(p.name != '.lock' for p in root.iterdir()):
            raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=60) as response:
        headers = response.headers
        etag = headers.get('ETag')
        validator = etag if etag and not etag.startswith('W/') else headers.get('Last-Modified')
        if not validator or headers.get('Accept-Ranges') != 'bytes':
            raise ValueError('no stable range validator')
        pin = {'url': url, 'bytes': int(headers['Content-Length']),
               'etag': etag, 'last_modified': headers.get('Last-Modified'),
               'validator': validator, 'chunk_bytes': chunk_bytes}
    manifest = root/'manifest.json'
    if manifest.exists() and json.loads(manifest.read_text()) != pin:
        raise ValueError('provider release or chunk contract changed')
    save(manifest, pin)
    ledger_path = root/'chunks.json'
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
    output = root/'source.partial'
    completed = root/'source.bin'
    if completed.exists():
        output = completed
    offset = 0
    if output.exists():
        with output.open('rb') as f:
            for chunk in ledger:
                data = f.read(chunk['bytes'])
                if chunk['offset'] != offset or hashlib.sha256(data).hexdigest() != chunk['sha256']:
                    raise ValueError('checkpoint bytes changed')
                offset += chunk['bytes']
        if output.stat().st_size < offset:
            raise ValueError('truncated checkpoint')
        if output.stat().st_size > offset:
            if output == completed:
                raise ValueError('unaccounted completed bytes')
            # Only this worker's uncommitted tail is recycled after interruption.
            with output.open('r+b') as f:
                f.truncate(offset)
    elif ledger:
        raise ValueError('checkpoint file missing')
    if (root/'receipt.json').exists():
        if offset != pin['bytes']:
            raise ValueError('completed receipt has incomplete data')
        return json.loads((root/'receipt.json').read_text())
    for _ in range(max_chunks if max_chunks is not None else (pin['bytes']-offset+chunk_bytes-1)//chunk_bytes):
        if offset == pin['bytes']:
            break
        if shutil.disk_usage(root).free < min_free_bytes + chunk_bytes:
            raise RuntimeError('live-workload headroom guard reached')
        end = min(offset + chunk_bytes, pin['bytes'])-1
        started = time.monotonic()
        request = urllib.request.Request(url, headers={
            'Range': f'bytes={offset}-{end}', 'If-Range': validator,
            'Accept-Encoding': 'identity'})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 206 or response.headers.get('Content-Range') != f'bytes {offset}-{end}/{pin["bytes"]}':
                raise ValueError('provider ignored range or changed release')
            if response.headers.get('ETag') != pin['etag'] or response.headers.get('Last-Modified') != pin['last_modified']:
                raise ValueError('provider validator changed')
            data = response.read(end-offset+2)
        if len(data) != end-offset+1:
            raise ValueError('short or oversized range')
        with output.open('ab') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        ledger.append({'offset': offset, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                       'transfer_seconds': time.monotonic()-started})
        save(ledger_path, ledger)
        offset += len(data)
        save(root/'progress.json', {'status': 'INCOMPLETE_SOURCE_BYTES', 'bytes': offset,
                                   'provider_bytes': pin['bytes'], 'chunks': len(ledger)})
        time.sleep(max(0, len(data)/bytes_per_second-(time.monotonic()-started)))
    if offset != pin['bytes']:
        return {'status': 'INCOMPLETE_SOURCE_BYTES', 'bytes': offset}
    with output.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    output.replace(completed)
    receipt = {'status': 'FULL_SOURCE_BYTES_ONLY', 'url': url, 'bytes': offset,
               'allocated_bytes': completed.stat().st_blocks*512, 'sha256': digest,
               'rows': None, 'full_serving_bytes': None, 'chunks': len(ledger),
               'transfer_seconds': sum(c['transfer_seconds'] for c in ledger),
               'validation_remaining': 'full schema and table read; normalized storage and serving artifacts'}
    save(root/'receipt.json', receipt)
    save(root/'progress.json', receipt)
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('url'); p.add_argument('root', type=Path)
    p.add_argument('--max-chunks', type=int)
    a = p.parse_args()
    print(json.dumps(fetch(a.url, a.root, max_chunks=a.max_chunks)))
