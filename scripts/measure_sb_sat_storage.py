#!/usr/bin/env python3
"""Measure a complete pinned SB-SAT API response and offline record locators.

JSONL preserves every nested scientific field and missing/null distinctions.
Parent IDs index relationships, not unique satellite identities. No ephemerides.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
from inventory_legacy_tractor import save


def sha(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def validate(raw):
    def pairs(items):
        result={}
        for k,v in items:
            if k in result:raise ValueError('duplicate JSON key')
            result[k]=v
        return result
    payload=json.loads(raw,object_pairs_hook=pairs)
    if payload.get('signature')!={'source':'NASA/JPL Small-Body Satellites API','version':'1.0'}:
        raise ValueError('unknown SB-SAT signature')
    rows=payload.get('data')
    if not isinstance(rows,list) or int(payload['count'])!=len(rows):
        raise ValueError('source count mismatch')
    for row in rows:
        if not isinstance(row,dict) or not isinstance(row.get('sat'),dict):raise ValueError('missing satellite record')
    return payload


def measure(source,expected_sha,documentation,output):
    if sha(source)!=expected_sha:raise ValueError('source checksum mismatch')
    payload=validate(source.read_bytes());rows=payload['data']
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated SB-SAT storage investigation 1271\n';owner=output/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'format':'sb-sat-complete-jsonl-offset-sqlite-v1','source_sha256':expected_sha,'documentation_sha256':sha(documentation)}
    manifest=output/'manifest.json'
    if manifest.exists() and json.loads(manifest.read_text())!=pin:raise ValueError('changed source contract')
    save(manifest,pin)
    data=output/'records.jsonl';index=output/'lookup.sqlite';metadata=output/'metadata.json'
    completed=output/'measurement.json'
    if completed.exists():
        result=json.loads(completed.read_text())
        for path,key in [(data,'data'),(index,'index'),(metadata,'metadata')]:
            if sha(path)!=result[key+'_sha256']:raise ValueError('changed completed artifact')
        return result
    started=time.monotonic();locators=[]
    with data.open('wb') as stream:
        for ordinal,row in enumerate(rows):
            raw=json.dumps(row,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()+b'\n'
            offset=stream.tell();stream.write(raw)
            for field in ('pdes','sat_fullname','iau_name'):
                value=row['sat'].get(field)
                if value is not None and value!='':locators.append((field,str(value),ordinal,offset,len(raw)))
        stream.flush();os.fsync(stream.fileno())
    save(metadata,{k:v for k,v in payload.items() if k!='data'})
    # Incomplete own indexes may be rebuilt; completed artifacts are never replaced.
    if index.exists():index.unlink()
    with sqlite3.connect(index) as db:
        db.execute('CREATE TABLE lookup(field TEXT,value TEXT,ordinal INTEGER,offset INTEGER,length INTEGER)')
        db.executemany('INSERT INTO lookup VALUES (?,?,?,?,?)',locators)
        db.execute('CREATE INDEX exact_lookup ON lookup(field,value)')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise ValueError('index integrity failure')
        if db.execute('SELECT count(*) FROM lookup').fetchone()[0]!=len(locators):raise ValueError('lookup count mismatch')
        with data.open('rb') as f:
            for field,value,ordinal,offset,length in db.execute('SELECT * FROM lookup'):
                f.seek(offset);restored=json.loads(f.read(length))
                if restored!=rows[ordinal] or str(restored['sat'][field])!=value:raise ValueError('offline locator mismatch')
    restored=[json.loads(line) for line in data.read_bytes().splitlines()]
    full=json.loads(metadata.read_text());full['data']=restored
    if full!=payload:raise ValueError('nested source fields lost')
    result={'status':'FULL_PINNED_API_RESPONSE_DATA_AND_EXACT_LOOKUP_MEASURED','rows':len(rows),
        'source_bytes':source.stat().st_size,'source_sha256':expected_sha,'lookup_entries':len(locators),
        'all_fields_and_locators_verified':True,'seconds':time.monotonic()-started,
        'confirmed':{str(v):sum(r['sat'].get('confirmed')==v for r in rows) for v in {r['sat'].get('confirmed') for r in rows}},
        'records_with_orbit':sum('orbit' in r for r in rows),'records_with_physical_parameters':sum('phys_par' in r for r in rows),
        'unique_primary_designations':len({r['sat']['pdes'] for r in rows if r['sat'].get('pdes')}),
        'records_missing_satellite_fullname':sum(not r['sat'].get('sat_fullname') for r in rows),
        'full_serving_bytes':None,'scope':'Complete requested API snapshot, not all historical orbital solutions. Original nested fields retained; default orbits are primary-centric, not heliocentric positions. No native ephemeris/rendering integration measured.'}
    for path,key in [(data,'data'),(index,'index'),(metadata,'metadata')]:
        result.update({key+'_bytes':path.stat().st_size,key+'_allocated_bytes':path.stat().st_blocks*512,key+'_sha256':sha(path)})
    result['data_index_metadata_bytes']=sum(result[k+'_bytes'] for k in ['data','index','metadata'])
    save(completed,result);return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('expected_sha256');p.add_argument('documentation',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();print(json.dumps(measure(a.source,a.expected_sha256,a.documentation,a.output)))
