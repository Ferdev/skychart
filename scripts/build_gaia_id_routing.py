#!/usr/bin/env python3
"""Build the real global ID-to-row-group routing index from verified Gaia receipts.

An ID range selects a candidate row group, never asserts an object exists.
Exact lookup must verify the ID inside that owned detail artifact. Partial
builds remain explicitly incomplete until every pinned manifest file reconciles.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import time


def build(root, output):
    start=time.monotonic()
    manifest=(root/'manifest.txt').read_bytes()
    names=[line.split()[1] for line in manifest.decode().splitlines() if line.split() and line.split()[-1].startswith('GaiaSource_')]
    if len(names)!=3386 or len(set(names))!=3386:raise ValueError('invalid full source manifest')
    db=sqlite3.connect(output)
    db.executescript('''PRAGMA cache_size=-8192;
      CREATE TABLE IF NOT EXISTS release (manifest_sha256 TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS files (file_id INTEGER PRIMARY KEY, source_name TEXT UNIQUE NOT NULL,
        detail_sha256 BLOB NOT NULL, rows INTEGER NOT NULL, detail_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS groups (min_id INTEGER PRIMARY KEY, max_id INTEGER NOT NULL,
        file_id INTEGER NOT NULL, group_number INTEGER NOT NULL, rows INTEGER NOT NULL,
        CHECK (min_id<=max_id), FOREIGN KEY(file_id) REFERENCES files(file_id));
    ''')
    digest=hashlib.sha256(manifest).hexdigest()
    pinned=db.execute('SELECT manifest_sha256 FROM release').fetchone()
    if pinned and pinned[0]!=digest:raise ValueError('release manifest changed')
    db.execute('INSERT OR IGNORE INTO release VALUES (?)',(digest,));db.commit()
    for file_id,name in enumerate(names):
        receipt=root/'receipts'/(name+'.json')
        if not receipt.exists():continue
        r=json.loads(receipt.read_text())
        if not r['all_field_roundtrip_verified'] or r['source_file']!=name:raise ValueError('unverified detail receipt')
        checksum=bytes.fromhex(r['parquet_sha256'])
        previous=db.execute('SELECT detail_sha256 FROM files WHERE file_id=?',(file_id,)).fetchone()
        if previous:
            if previous[0]!=checksum:raise ValueError('detail artifact changed')
            continue
        groups=r['row_groups']
        if sum(g['rows'] for g in groups)!=r['rows']:raise ValueError('group row accounting mismatch')
        previous_max=None
        with db:
            db.execute('INSERT INTO files VALUES (?,?,?,?,?)',(file_id,name,checksum,r['rows'],r['parquet_bytes']))
            for n,g in enumerate(groups):
                lo,hi=int(g['min_id']),int(g['max_id'])
                if previous_max is not None and lo<=previous_max:raise ValueError('overlapping source ranges')
                previous_max=hi
                predecessor=db.execute('SELECT max_id FROM groups WHERE min_id<=? ORDER BY min_id DESC LIMIT 1',(hi,)).fetchone()
                if predecessor and predecessor[0]>=lo:raise ValueError('overlapping global source ranges')
                db.execute('INSERT INTO groups VALUES (?,?,?,?,?)',(lo,hi,file_id,n,g['rows']))
    overlap=db.execute('SELECT 1 FROM (SELECT min_id,lag(max_id) OVER (ORDER BY min_id) previous_max FROM groups) WHERE previous_max>=min_id LIMIT 1').fetchone()
    if overlap:raise ValueError('global source ID ranges overlap')
    files,rows=db.execute('SELECT count(*),coalesce(sum(rows),0) FROM files').fetchone()
    group_rows=db.execute('SELECT coalesce(sum(rows),0) FROM groups').fetchone()[0]
    if rows!=group_rows:raise ValueError('global route accounting failed')
    if files==3386 and rows!=1811709771:raise ValueError('full release row count mismatch')
    if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('routing database corrupt')
    db.close()
    result={'artifact':'Gaia global ID-to-candidate-row-group routing SQLite v1',
            'status':'COMPLETE_COMPONENT' if files==3386 else 'INCOMPLETE',
            'measured_files':files,'expected_files':3386,'accounted_rows':rows,
            'logical_bytes':output.stat().st_size,'allocated_bytes':output.stat().st_blocks*512,
            'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'seconds':time.monotonic()-start,
            'remaining':['exact-ID membership verification in owned detail row group','aliases/text/brightness search',
                         'angular/physical search','crossmatches','rendering artifacts','native API integration'],
            'full_serving_total':None}
    output.with_suffix('.receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();print(json.dumps(build(a.root,a.output)))
