#!/usr/bin/env python3
"""Read-only, bounded warm-query trial; not full-release/native API latency."""
import argparse
import json
from pathlib import Path
import sqlite3
import statistics
import time

import pyarrow.parquet as pq


def benchmark(root):
    if (root / 'OWNER').read_text() != 'SkyChart exhaustive PSC investigation 1271\n':
        raise ValueError('unowned experiment')
    index_receipt = json.loads((root / 'lookup.receipt.json').read_text())
    if (index_receipt['status'] != 'COMPLETE_COMPONENT' or index_receipt['files'] != 92
            or index_receipt['rows'] != 470992970):
        raise ValueError('complete PSC lookup required')
    manifest = json.loads((root / 'manifest.json').read_text())
    files = manifest['files']
    if len(files) != 92:
        raise ValueError('complete PSC manifest required')
    durations = {'id': [], 'designation': [], 'angular': []}
    samples = 0
    with sqlite3.connect((root / 'lookup.sqlite').resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA cache_size=-8192')
        for file_id in [0, len(files)//2, len(files)-1]:
            source_name = files[file_id]['file']
            receipt = json.loads((root / 'receipts' / (source_name + '.json')).read_text())
            projection = pq.ParquetFile(root / 'build-projections' / receipt['build_projection']['file'])
            for group in sorted({0, projection.num_row_groups // 2, projection.num_row_groups - 1}):
                rows = projection.read_row_group(group, columns=['pts_key', 'designation', 'ra', 'decl'], use_threads=False).to_pylist()
                for offset in sorted({0, len(rows)//2, len(rows)-1}):
                    r = rows[offset];samples += 1
                    for repeat in range(10):
                        start = time.perf_counter()
                        got = db.execute('SELECT designation,ra,dec,file_id,row_group,row_offset FROM lookup WHERE pts_key=?', (r['pts_key'],)).fetchone()
                        durations['id'].append((time.perf_counter()-start)*1000)
                        if got != (r['designation'],r['ra'],r['decl'],file_id,group,offset):
                            raise ValueError('ID or row locator differs from projection')
                        start = time.perf_counter()
                        named = db.execute('SELECT pts_key FROM lookup INDEXED BY designation_index WHERE designation=? ORDER BY pts_key LIMIT 100', (r['designation'],)).fetchall()
                        durations['designation'].append((time.perf_counter()-start)*1000)
                        if (r['pts_key'],) not in named:
                            raise ValueError('designation lookup missing sampled record')
                        # Rectangle candidate query, with exact double-coordinate filtering.
                        lo, hi, bottom, top = r['ra']-.05, r['ra']+.05, r['decl']-.05, r['decl']+.05
                        start = time.perf_counter()
                        found = db.execute('''SELECT l.pts_key,l.ra,l.dec FROM angular a JOIN lookup l USING(pts_key)
                          WHERE a.max_ra>=? AND a.min_ra<=? AND a.max_dec>=? AND a.min_dec<=?
                          AND l.ra BETWEEN ? AND ? AND l.dec BETWEEN ? AND ? LIMIT 100''',
                          (lo,hi,bottom,top,lo,hi,bottom,top)).fetchall()
                        durations['angular'].append((time.perf_counter()-start)*1000)
                        if any(not(lo<=ra<=hi and bottom<=dec<=top) for _,ra,dec in found):
                            raise ValueError('angular bounds violated')
    return {'scope':'complete 470,992,970-row index; beginning/middle/end projection samples; repeated warm local SQLite queries; not server/browser budgets',
            'index_bytes':index_receipt['logical_bytes'],'index_sha256':index_receipt['sha256'],
            'files_sampled':3,'locator_samples_verified':samples,'detail_hydration_verified':False,
            'latency_ms':{k:{'queries':len(v),'median':statistics.median(v),'p95':sorted(v)[int(.95*(len(v)-1))],'max':max(v)} for k,v in durations.items()},
            'full_release_serving_bytes':None}


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path)
    print(json.dumps(benchmark(p.parse_args().root),indent=2))
