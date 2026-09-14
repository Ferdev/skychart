#!/usr/bin/env python3
"""Acquire four complete SBDB category queries sequentially, without paging.

Category files are measurements, not proof of an atomic global snapshot.
Cross-category ID reconciliation and upstream mutation checks remain required.
"""
import argparse
import fcntl
import json
from pathlib import Path
import time
import urllib.request

from download_sbdb_storage_source import main as acquire
from download_exoplanet_storage_source import save


def measure(root, metadata):
    root.mkdir(parents=True, exist_ok=True)
    lock = (root / '.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    owner = root / 'OWNER'
    marker = 'SkyChart isolated SBDB category measurement 1271\n'
    if owner.exists():
        if owner.read_text() != marker:
            raise ValueError('unowned category output')
    else:
        if any(p.name != '.lock' for p in root.iterdir()):
            raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    # One request at a time, including these metadata requests.
    for phase in ['before', 'after']:
        if phase == 'after':
            for category in ['cn', 'cu', 'an', 'au']:
                save(root / 'progress.json', {'status': 'INCOMPLETE', 'current_category': category})
                acquire(root / category, metadata, category)
        target = root / (phase + '-provider-counts.json')
        if phase == 'before' and target.exists():
            continue
        url = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api?info=count'
        with urllib.request.urlopen(url, timeout=120) as response:
            body = response.read(1 << 20)
        save(target, {'url': url, 'fetched_unix': time.time(), 'response': json.loads(body)})
    receipts = {c: json.loads((root / c / 'receipt.json').read_text()) for c in ['cn', 'cu', 'an', 'au']}
    save(root / 'measurement.json', {
        'status': 'INCOMPLETE_GLOBAL_RECONCILIATION', 'categories': receipts,
        'measured_category_source_bytes': sum(r['source_bytes'] for r in receipts.values()),
        'measured_category_rows': sum(r['rows'] for r in receipts.values()),
        'full_snapshot_bytes': None, 'full_serving_bytes': None,
        'remaining': ['cross-category exact ID reconciliation', 'upstream mutation checks',
                      'normalized storage', 'global indexes and native serving artifacts']})
    save(root / 'progress.json', {'status': 'INCOMPLETE_GLOBAL_RECONCILIATION', 'categories_acquired': 4})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('metadata', type=Path)
    args = parser.parse_args()
    measure(args.root, args.metadata)
