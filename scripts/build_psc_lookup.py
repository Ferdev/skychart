#!/usr/bin/env python3
"""Measure a real PSC ID/designation/angular index from verified build inputs.

Each source file commits atomically. A failed file rolls back; prior files
remain resumable. Coordinates in the R-tree are bounding candidates only:
filter against lookup.ra/dec for exact angular bounds. No physical depth or
object identity is asserted. Crossmatches and rendering are separate artifacts.
"""
import argparse
import fcntl
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import time

import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard, save, sha

FORMAT = 'psc-id-designation-angular-sqlite-v1'


def build(root, output, max_files=0, floor=100 * (1 << 30), wait_for_files=False):
    started = time.monotonic()
    if (root / 'OWNER').read_text() != 'SkyChart exhaustive PSC investigation 1271\n':
        raise ValueError('unowned PSC investigation directory')
    if output.resolve().parent != root.resolve():
        raise ValueError('index must stay in owned PSC investigation directory')
    if max_files < 0:
        raise ValueError('max_files must be nonnegative')
    lock = output.with_suffix('.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    manifest_bytes = (root / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    names = [entry['file'] for entry in manifest['files']]
    if len(names) != 92 or len(set(names)) != 92:
        raise ValueError('invalid full PSC manifest')
    pin = hashlib.sha256(manifest_bytes).hexdigest()
    added = 0
    sampled_at = 0
    workspace_peak = {'logical_bytes':0,'allocated_bytes':0,'journal_bytes':0}
    with sqlite3.connect(output) as db:
        db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
          PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS release (format TEXT PRIMARY KEY, manifest_sha256 TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS files (file_id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
            projection_sha256 TEXT NOT NULL, detail_sha256 TEXT NOT NULL, rows INTEGER NOT NULL,
            angular_rows INTEGER NOT NULL, seconds REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS lookup (pts_key INTEGER PRIMARY KEY, designation TEXT,
            ra REAL, dec REAL, file_id INTEGER NOT NULL REFERENCES files(file_id),
            row_group INTEGER NOT NULL, row_offset INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS designation_index ON lookup(designation);
          CREATE VIRTUAL TABLE IF NOT EXISTS angular USING rtree(pts_key,min_ra,max_ra,min_dec,max_dec);
        ''')
        old = db.execute('SELECT format,manifest_sha256 FROM release').fetchall()
        if old and old != [(FORMAT, pin)]:
            raise ValueError('index release changed')
        db.execute('INSERT OR IGNORE INTO release VALUES (?,?)', (FORMAT, pin)); db.commit()
        for file_id, name in enumerate(names):
            receipt = root / 'receipts' / (name + '.json')
            while wait_for_files and not receipt.exists():
                guard(output.parent, floor)
                save(output.with_suffix('.progress.json'), {'status':'WAITING_FOR_VERIFIED_INPUT',
                     'file':name,'updated_unix':time.time(),'full_serving_bytes':None})
                time.sleep(30)
            if not receipt.exists():
                continue
            r = json.loads(receipt.read_text())
            if r['source_file'] != name or not r['all_fields_verified']:
                raise ValueError('unverified source receipt')
            prior = db.execute('SELECT projection_sha256,detail_sha256 FROM files WHERE file_id=?', (file_id,)).fetchone()
            checksums = (r['build_projection']['sha256'], r['detail_sha256'])
            if prior:
                if prior != checksums:
                    raise ValueError('indexed source changed')
                continue
            if max_files and added >= max_files:
                break
            projection_name = r['build_projection']['file']
            if Path(projection_name).name != projection_name:
                raise ValueError('unsafe projection path')
            projection = root / 'build-projections' / projection_name
            if sha(projection) != checksums[0]:
                raise ValueError('projection checksum mismatch')
            table = pq.ParquetFile(projection)
            if table.metadata.num_rows != r['rows']:
                raise ValueError('projection row mismatch')
            file_start = time.monotonic(); rows = 0; angular_rows = 0
            with db:
                db.execute('INSERT INTO files VALUES (?,?,?,?,?,?,?)',
                           (file_id, name, *checksums, r['rows'], 0, 0))
                for group in range(table.num_row_groups):
                    batch = table.read_row_group(group, columns=['pts_key','designation','ra','decl'], use_threads=False).to_pylist()
                    lookups = []; points = []
                    for offset, record in enumerate(batch):
                        key = record['pts_key']; ra = record['ra']; dec = record['decl']
                        if key is None:
                            raise ValueError('missing PSC source ID')
                        lookups.append((key,record['designation'],ra,dec,file_id,group,offset))
                        if ra is not None and dec is not None and math.isfinite(ra) and math.isfinite(dec) and 0 <= ra < 360 and -90 <= dec <= 90:
                            points.append((key,ra,ra,dec,dec))
                    db.executemany('INSERT INTO lookup VALUES (?,?,?,?,?,?,?)', lookups)
                    db.executemany('INSERT INTO angular VALUES (?,?,?,?,?)', points)
                    rows += len(batch); angular_rows += len(points)
                    guard(output.parent, floor)
                    if time.monotonic()-sampled_at >= 10:
                        sampled_at = time.monotonic()
                        stats=[]
                        for path in root.rglob('*'):
                            try:
                                if path.is_file():stats.append(path.stat())
                            except FileNotFoundError:pass
                        journal=Path(str(output)+'-journal')
                        sizes={'logical_bytes':sum(s.st_size for s in stats),
                               'allocated_bytes':sum(s.st_blocks*512 for s in stats),
                               'journal_bytes':journal.stat().st_size if journal.exists() else 0}
                        for key in workspace_peak:workspace_peak[key]=max(workspace_peak[key],sizes[key])
                        save(output.with_suffix('.workspace.json'), {'observed_peak':workspace_peak,
                             'current':sizes,'updated_unix':time.time(),'instantaneous_peak_exact':False,
                             'scope':'owned root named files; unlinked files and between-sample peaks excluded'})
                if rows != r['rows']:
                    raise ValueError('decoded row accounting failed')
                db.execute('UPDATE files SET angular_rows=?,seconds=? WHERE file_id=?',
                           (angular_rows,time.monotonic()-file_start,file_id))
            added += 1
            files_done, rows_done = db.execute('SELECT count(*),sum(rows) FROM files').fetchone()
            save(output.with_suffix('.progress.json'), {'status':'INCOMPLETE_BUILD',
                 'committed_files':files_done,'committed_rows':rows_done,
                 'logical_bytes':output.stat().st_size,'updated_unix':time.time(),
                 'full_serving_bytes':None})
            print(json.dumps({'file':name,'rows':rows,'angular_rows':angular_rows,'seconds':time.monotonic()-file_start}),flush=True)
        files, rows, angular_rows = db.execute('SELECT count(*),coalesce(sum(rows),0),coalesce(sum(angular_rows),0) FROM files').fetchone()
        if db.execute('SELECT count(*) FROM lookup').fetchone()[0] != rows or db.execute('SELECT count(*) FROM angular').fetchone()[0] != angular_rows:
            raise ValueError('global index accounting failed')
        if db.execute('SELECT rtreecheck(?)', ('angular',)).fetchone()[0] != 'ok':
            raise ValueError('angular index corrupt')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('lookup index corrupt')
        if files == 92 and rows != 470992970:
            raise ValueError('full PSC count mismatch')
    db.close()
    result = {'format':FORMAT,'status':'COMPLETE_COMPONENT' if files == 92 else 'INCOMPLETE',
              'files':files,'rows':rows,'angular_rows':angular_rows,'logical_bytes':output.stat().st_size,
              'allocated_bytes':output.stat().st_blocks*512,'sha256':sha(output),'seconds':time.monotonic()-started,
              'full_serving_bytes':None,'remaining':['offline detail hydration','crossmatches and identity evidence',
              'photometry search','rendering tiles','native API integration and latency benchmarks']}
    save(output.with_suffix('.receipt.json'), result)
    save(output.with_suffix('.progress.json'), {'status':result['status'],
         'committed_files':files,'committed_rows':rows,'updated_unix':time.time(),
         'full_serving_bytes':None})
    lock.close()
    return result


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('root',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--max-files',type=int,default=0)
    p.add_argument('--wait-for-files',action='store_true')
    a=p.parse_args();print(json.dumps(build(a.root,a.output,a.max_files,wait_for_files=a.wait_for_files)))
