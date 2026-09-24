#!/usr/bin/env python3
"""Reconcile full SBDB category exports against an independent ID/orbit census.

The temporary SQLite is audit workspace, not a native serving index. Matching
IDs and orbit versions cannot establish that every physical field was unchanged
throughout acquisition of a mutable upstream database.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import time
import urllib.request
import ijson

from download_exoplanet_storage_source import save
from download_sbdb_storage_source import audit


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()


def insert_category(db, source, fields, category):
    columns=[fields.index(n) for n in ['spkid','kind','orbit_id']]
    rows=0
    with source.open('rb') as f:
        for record in ijson.items(f,'data.item'):
            if len(record)!=len(fields):raise ValueError('category row width changed')
            key,kind,orbit=(record[i] for i in columns)
            if kind!=category:raise ValueError('category membership changed')
            db.execute('INSERT INTO census VALUES (?,?,?)',(int(key),kind,orbit))
            rows+=1
    return rows


def compare(db, source):
    rows=0;differences=0;examples=[]
    with source.open('rb') as f:
        for key,kind,orbit in ijson.items(f,'data.item'):
            got=db.execute('SELECT kind,orbit_id FROM census WHERE spkid=?',(int(key),)).fetchone()
            if got!=(kind,orbit):
                differences+=1
                if len(examples)<20:examples.append({'spkid':str(key),'category_value':got,'census_value':[kind,orbit]})
            rows+=1
    return {'census_rows':rows,'differing_ids_or_orbits':differences,'difference_examples':examples}


def main(root):
    if (root/'OWNER').read_text()!='SkyChart isolated SBDB category measurement 1271\n':
        raise ValueError('unowned SBDB directory')
    lock=(root/'reconciliation.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    started=time.time();measurement=json.loads((root/'measurement.json').read_text())
    source=root/'independent-census.json'
    url='https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=spkid,kind,orbit_id&full-prec=true&sort=spkid'
    if not (root/'independent-census.receipt.json').exists():
        save(root/'reconciliation.progress.json',{'status':'DOWNLOADING_INDEPENDENT_CENSUS','started_unix':started})
        with urllib.request.urlopen(url,timeout=600) as response,source.with_suffix('.partial').open('wb') as f:
            while block:=response.read(1<<20):
                if shutil.disk_usage(root).free<100*(1<<30):raise RuntimeError('live headroom guard')
                f.write(block)
            f.flush();os.fsync(f.fileno())
        source.with_suffix('.partial').replace(source)
        result=audit(source,['spkid','kind','orbit_id'])
        result.update(url=url,started_unix=started,finished_unix=time.time())
        save(root/'independent-census.receipt.json',result)
    receipt=json.loads((root/'independent-census.receipt.json').read_text())
    if digest(source)!=receipt['sha256']:raise ValueError('independent census changed')
    output=root/'reconciliation.sqlite'
    with sqlite3.connect(output) as db:
        db.executescript('PRAGMA cache_size=-8192; CREATE TABLE IF NOT EXISTS census(spkid INTEGER PRIMARY KEY,kind TEXT,orbit_id TEXT); CREATE TABLE IF NOT EXISTS files(category TEXT PRIMARY KEY,sha256 TEXT,rows INTEGER);')
        for category,r in measurement['categories'].items():
            save(root/'reconciliation.progress.json',{'status':'RECONCILING','category':category})
            path=root/category/'full.json'
            if digest(path)!=r['sha256']:raise ValueError('category source changed')
            old=db.execute('SELECT sha256,rows FROM files WHERE category=?',(category,)).fetchone()
            if old:
                if old!=(r['sha256'],r['rows']):raise ValueError('category receipt changed')
                continue
            # Keep inserted IDs and the completion marker in one transaction.
            db.execute('BEGIN')
            try:
                rows=insert_category(db,path,r['fields'],category)
                if rows!=r['rows']:raise ValueError('category accounting mismatch')
                db.execute('INSERT INTO files VALUES (?,?,?)',(category,r['sha256'],rows));db.commit()
            except Exception:
                db.rollback();raise
        result=compare(db,source)
        unique=db.execute('SELECT count(*) FROM census').fetchone()[0]
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('audit workspace corrupt')
    db.close()
    before=json.loads((root/'before-provider-counts.json').read_text())['response']['info']['count']
    after=json.loads((root/'after-provider-counts.json').read_text())['response']['info']['count']
    measured={k:r['rows'] for k,r in measurement['categories'].items()}
    matched=result['differing_ids_or_orbits']==0 and unique==result['census_rows']==receipt['rows'] and measured==before==after
    result.update(status='IDS_AND_ORBIT_VERSIONS_RECONCILED' if matched else 'INCOMPLETE_RECONCILIATION_MISMATCH',
                  unique_category_ids=unique,provider_counts_unchanged=before==after,category_counts=measured,
                  census_sha256=receipt['sha256'],workspace_bytes=output.stat().st_size,
                  workspace_allocated_bytes=output.stat().st_blocks*512,workspace_sha256=digest(output),
                  seconds=time.time()-started,full_snapshot_bytes=None,full_serving_bytes=None,
                  limitation='Independent census checks IDs, kinds and orbit versions only; other mutable scientific fields and atomic snapshot consistency unproven')
    save(root/'reconciliation.receipt.json',result);save(root/'reconciliation.progress.json',{'status':result['status']})
    print(json.dumps(result),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);main(p.parse_args().root)
