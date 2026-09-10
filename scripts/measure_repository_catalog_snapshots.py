#!/usr/bin/env python3
"""Measure pinned, complete owned compilations without claiming upstream coverage."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def measure(repo):
    revision = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    results = []
    for catalog, filename in [('messier', 'deep_sky_catalog.json'),
                              ('curated-landmarks', 'curated_extragalactic_survey.json')]:
        relative = 'data/catalogs/' + filename
        path = repo / relative
        raw = path.read_bytes()
        committed = subprocess.check_output(['git', '-C', str(repo), 'show', revision + ':' + relative])
        if raw != committed:
            raise ValueError('snapshot differs from pinned revision: ' + relative)
        payload = json.loads(raw)
        rows = payload['objects']
        keys = [row['key'] for row in rows]
        if len(set(keys)) != len(keys) or payload.get('object_count', len(rows)) != len(rows):
            raise ValueError('snapshot row/key accounting mismatch')
        if catalog == 'messier' and sorted(row['messier'] for row in rows) != list(range(1, 111)):
            raise ValueError('Messier compilation is not exactly M1 through M110')
        digest = hashlib.sha256(raw).hexdigest()
        results.append({
            'catalog': catalog, 'status': 'FULL_OWNED_COMPILATION_JSON_MEASURED',
            'revision': revision, 'path': relative, 'sha256': digest,
            'artifact_id': 'sha256:' + digest, 'bytes': len(raw),
            'allocated_bytes': path.stat().st_blocks * 512, 'rows': len(rows),
            'distinct_public_keys': len(set(keys)),
            'record_fields': sorted({field for row in rows for field in row}),
            'metadata': {key: value for key, value in payload.items() if key != 'objects'},
            'storage_format': 'Original complete JSON file, including every field and metadata byte',
            'counting': 'One existing artifact serves as compilation source and stored JSON; count its bytes once.',
            'upstream_complete_bytes': None, 'full_serving_bytes': None,
            'remaining': ['upstream releases remain separate registry entries',
                          'runtime hydration, indexes, rendering and native API budgets'],
        })
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', type=Path)
    args = parser.parse_args()
    print(json.dumps(measure(args.repository.resolve()), indent=2))
