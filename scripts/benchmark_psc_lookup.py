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
    receipt = json.loads((root / 'receipts/psc_aaa.gz.json').read_text())
    projection = pq.ParquetFile(root / 'build-projections' / receipt['build_projection']['file'])
    durations = {'id': [], 'designation': [], 'angular': []}
    with sqlite3.connect((root / 'lookup.sqlite').resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA cache_size=-8192')
        for group in sorted({0, projection.num_row_groups // 2, projection.num_row_groups - 1}):
            rows = projection.read_row_group(group, columns=['pts_key', 'designation', 'ra', 'decl'], use_threads=False).to_pylist()
            for offset in sorted({0, len(rows)//2, len(rows)-1}):
                r = rows[offset]
                for repeat in range(10):
                    start = time.perf_counter()
                    got = db.execute('SELECT designation,ra,dec,file_id,row_group,row_offset FROM lookup WHERE pts_key=?', (r['pts_key'],)).fetchone()
                    durations['id'].append((time.perf_counter()-start)*1000)
                    if got != (r['designation'],r['ra'],r['decl'],0,group,offset):
                        raise ValueError('ID or row locator differs from projection')
                    start = time.perf_counter()
                    named = db.execute('SELECT pts_key FROM lookup WHERE designation=? ORDER BY pts_key LIMIT 100', (r['designation'],)).fetchall()
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
    return {'scope':'single 5,144,500-row file; repeated warm local SQLite queries; not server/browser budgets',
            'locator_samples_verified':9,'detail_hydration_verified':False,
            'latency_ms':{k:{'queries':len(v),'median':statistics.median(v),'p95':sorted(v)[int(.95*(len(v)-1))],'max':max(v)} for k,v in durations.items()},
            'full_release_serving_bytes':None}


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path)
    print(json.dumps(benchmark(p.parse_args().root),indent=2))
