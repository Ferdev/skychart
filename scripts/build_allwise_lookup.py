#!/usr/bin/env python3
"""Measure one global AllWISE ID/designation-to-owned-row-group lookup.

Source records stay distinct. Angular tiles, crossmatches and native API
integration are separate artifacts; this index does not assert object identity.
"""
import argparse
import csv
import fcntl
import json
from pathlib import Path
import sqlite3
import time
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard,save,sha


def insert_partition(db,projection,file_id):
    table=pq.ParquetFile(projection);rows=0
    for group in range(table.num_row_groups):
        for offset,r in enumerate(table.read_row_group(group,columns=['cntr','designation'],use_threads=False).to_pylist()):
            if r['cntr'] is None:raise ValueError('missing source ID')
            db.execute('INSERT INTO objects VALUES (?,?,?,?,?)',(r['cntr'],r['designation'],file_id,group,offset));rows+=1
    return rows


def build(root,manifest,max_files=0,wait=False,floor=100*(1<<30)):
    if (root/'OWNER').read_text()!='SkyChart isolated full AllWISE measurement 1271\n':raise ValueError('unowned root')
    lock=(root/'lookup.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    files=list(csv.DictReader(manifest.open()))
    if len(files)!=12288 or len({r['path'] for r in files})!=12288:raise ValueError('invalid complete manifest')
    source_pin=json.loads((root/'manifest.json').read_text())
    if sha(manifest)!=source_pin['rows_sha256']:raise ValueError('source manifest changed')
    index=root/'lookup.sqlite';started=time.monotonic();added=0
    with sqlite3.connect(index) as db:
        db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
          CREATE TABLE IF NOT EXISTS release(manifest_sha256 TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS objects(cntr INTEGER PRIMARY KEY,designation TEXT,file_id INTEGER,row_group INTEGER,row_offset INTEGER);
          CREATE INDEX IF NOT EXISTS designation_index ON objects(designation COLLATE NOCASE);
          CREATE TABLE IF NOT EXISTS files(file_id INTEGER PRIMARY KEY,path TEXT,projection_sha256 TEXT,detail_sha256 TEXT,rows INTEGER,seconds REAL);''')
        old=db.execute('SELECT manifest_sha256 FROM release').fetchall()
        if old and old!=[(sha(manifest),)]:raise ValueError('lookup release changed')
        db.execute('INSERT OR IGNORE INTO release VALUES (?)',(sha(manifest),));db.commit()
        for file_id,item in enumerate(files):
            receipt=root/'receipts'/f'{file_id:05d}.json'
            while wait and not receipt.exists():
                guard(root,floor);save(root/'lookup.progress.json',{'status':'WAITING_FOR_VERIFIED_INPUT','file_id':file_id});time.sleep(30)
            if not receipt.exists():continue
            r=json.loads(receipt.read_text())
            if not r['all_fields_verified'] or r['path']!=item['path'] or r['rows']!=int(item['nrows']):raise ValueError('unverified source receipt')
            checks=(r['build_projection']['sha256'],r['detail_sha256'])
            prior=db.execute('SELECT projection_sha256,detail_sha256 FROM files WHERE file_id=?',(file_id,)).fetchone()
            if prior:
                if prior!=checks:raise ValueError('indexed input changed')
                continue
            if max_files and added>=max_files:break
            projection=root/'build-projections'/f'{file_id:05d}.parquet'
            if sha(projection)!=checks[0]:raise ValueError('projection checksum mismatch')
            guard(root,floor);file_started=time.monotonic()
            with db:
                count=insert_partition(db,projection,file_id)
                if count!=r['rows']:raise ValueError('partition index count mismatch')
                db.execute('INSERT INTO files VALUES (?,?,?,?,?,?)',(file_id,item['path'],*checks,count,time.monotonic()-file_started))
            guard(root,floor);added+=1
            committed,rows=db.execute('SELECT count(*),sum(rows) FROM files').fetchone()
            save(root/'lookup.progress.json',{'status':'INCOMPLETE_BUILD','files':committed,'rows':rows,'logical_bytes':index.stat().st_size})
        count,rows=db.execute('SELECT count(*),coalesce(sum(rows),0) FROM files').fetchone()
        if db.execute('SELECT count(*) FROM objects').fetchone()[0]!=rows:raise ValueError('global row accounting mismatch')
        if count==12288 and rows!=747634026:raise ValueError('full release count mismatch')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('lookup integrity failed')
    db.close()
    result={'status':'FULL_LOOKUP_COMPONENT_MEASURED' if count==12288 else 'INCOMPLETE','files':count,'rows':rows,
            'logical_bytes':index.stat().st_size,'allocated_bytes':index.stat().st_blocks*512,'sha256':sha(index),
            'seconds':time.monotonic()-started,'full_serving_bytes':None,
            'remaining':['offline full-detail hydration','angular rendering/index artifacts','crossmatch evidence','native API and latency budgets']}
    save(root/'lookup.receipt.json',result);return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('manifest',type=Path);p.add_argument('--max-files',type=int,default=0);p.add_argument('--wait-for-files',action='store_true')
    a=p.parse_args();print(json.dumps(build(a.root,a.manifest,a.max_files,a.wait_for_files)))
