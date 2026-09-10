#!/usr/bin/env python3
"""Pin official DR10 Tractor checksum manifests sequentially; no data totals."""
import argparse
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import time
import urllib.request


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.extend(value for key, value in attrs if key == 'href')


def parse(raw, directory):
    entries = {}
    for line in raw.decode('ascii').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})\s+\*?(tractor-(\d{3})\d[pm]\d{3}\.fits)', line)
        if not match or match[3] != directory or match[2] in entries:
            raise ValueError('invalid/duplicate checksum entry or brick directory mismatch')
        entries[match[2]] = match[1]
    if not entries:
        raise ValueError('empty checksum manifest')
    return entries


def save(path, value):
    # Reuse the fsync/atomic helper without loading the heavy conversion stack.
    import os
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run(listing, output):
    root_bytes = listing.read_bytes()
    parser = Links(); parser.feed(root_bytes.decode())
    directories = sorted(link[:-1] for link in parser.links if re.fullmatch(r'\d{3}/', link))
    if directories != [f'{n:03d}' for n in range(360)]:
        raise ValueError('expected complete 360-directory source listing')
    output.mkdir(parents=True, exist_ok=True)
    lock = (output / '.lock').open('w'); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    owner = output / 'OWNER'; marker = 'SkyChart isolated Legacy Tractor metadata investigation 1271\n'
    if owner.exists():
        if owner.read_text() != marker:
            raise ValueError('unowned output')
    else:
        if any(p.name != '.lock' for p in output.iterdir()):
            raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    base = 'https://portal.nersc.gov/cfs/cosmo/data/legacysurvey/dr10/south/tractor/'
    pin = {'base_url': base, 'root_listing_sha256': hashlib.sha256(root_bytes).hexdigest(),
           'directories': directories, 'scope': 'Official checksum metadata only, not downloaded catalog records'}
    manifest = output / 'manifest.json'
    if manifest.exists() and json.loads(manifest.read_text()) != pin:
        raise ValueError('root listing changed')
    save(manifest, pin)
    total = 0; completed = 0; errors = []
    for directory in directories:
        raw_path = output / (directory + '.sha256sum')
        receipt_path = output / (directory + '.json')
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            raw = raw_path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != receipt['sha256']:
                raise ValueError('accepted provider manifest changed')
            entries = parse(raw, directory)
            if len(entries) != receipt['provider_file_count']:
                raise ValueError('accepted manifest count changed')
        else:
            url = base + directory + '/legacysurvey_dr10_south_tractor_' + directory + '.sha256sum'
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(url, timeout=60) as response:
                        raw = response.read(); headers = dict(response.headers)
                    entries = parse(raw, directory)
                    with raw_path.open('wb') as stream:
                        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
                    receipt = {'url': url, 'observed_unix': time.time(), 'headers': headers,
                               'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                               'provider_file_count': len(entries), 'catalog_bytes': None, 'catalog_rows': None}
                    save(receipt_path, receipt)
                    break
                except Exception as error:
                    if attempt == 2:
                        errors.append({'directory': directory, 'error': str(error)})
                        receipt = None
                    else:
                        time.sleep(5 * (attempt + 1))
            time.sleep(1)
            if receipt is None:
                save(output / 'errors.json', errors)
                continue
        completed += 1; total += len(entries)
        save(output / 'progress.json', {'status': 'PROVIDER_MANIFEST_INVENTORY_ONLY',
             'completed_directories': completed, 'expected_directories': 360,
             'provider_file_count': total, 'errors': errors, 'catalog_bytes': None,
             'catalog_rows': None, 'full_serving_bytes': None})
    result = {'status': 'FULL_PROVIDER_MANIFEST_SET_PINNED' if not errors else 'INCOMPLETE_PROVIDER_MANIFEST_INVENTORY',
              'completed_directories': completed, 'expected_directories': 360,
              'provider_file_count': total, 'errors': errors, 'catalog_bytes': None,
              'catalog_rows': None, 'full_serving_bytes': None,
              'remaining': 'All source downloads, full schemas/row audits, storage and serving artifacts. Cross-file release coherence unverified.'}
    save(output / 'inventory.json', result)
    save(output / 'progress.json', result)
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('listing', type=Path); p.add_argument('output', type=Path)
    a = p.parse_args(); print(json.dumps(run(a.listing, a.output)))
