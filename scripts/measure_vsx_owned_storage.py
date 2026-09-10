#!/usr/bin/env python3
"""Measure complete VSX source fields and isolated ID/name/angular lookup.

Measurements retain source precision as strings/nulls, with source schema in
Parquet metadata. Angular indexing uses source J2000 RA/Dec; no depth is added.
"""
import argparse
import fcntl
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import pyarrow as pa
import pyarrow.parquet as pq
from audit_cds_fixed_width import schema
from measure_gaia_full_partitions import guard,save,sha

FORMAT='vsx-all21-original-text-zstd3-rg4096-v1'


def records(source,fields):
    width=max(f['end'] for f in fields)
    with source.open('rb') as stream:
        for line in stream:
            raw=line.rstrip(b'\r\n')
            if len(raw)!=width:raise ValueError('source row width changed')
            yield {f['name']:(raw[f['start']-1:f['end']].strip().decode('ascii') or None) for f in fields}


def convert(source,readme,output,expected_rows,expected_sha,floor):
    if sha(source)!=expected_sha:raise ValueError('source changed')
    fields=schema(readme,'vsx.dat')
    contract=pa.schema([(f['name'],pa.string()) for f in fields],metadata={
        b'format':FORMAT.encode(),b'source_sha256':expected_sha.encode(),
        b'cds_readme':readme.read_bytes(),b'normalization':b'Fixed-width padding removed; blanks become null; all numerical precision and flags retained; no distance inferred'})
    stream=records(source,fields);part=output.with_suffix('.partial');rows=0
    with pq.ParquetWriter(part,contract,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        while batch:=list(itertools.islice(stream,4096)):
            guard(output.parent,floor);writer.write_table(pa.Table.from_pylist(batch,schema=contract),row_group_size=4096);rows+=len(batch)
    if rows!=expected_rows:raise ValueError('full source count mismatch')
    stream=records(source,fields);verified=0;stored=pq.ParquetFile(part)
    for group in range(stored.num_row_groups):
        for record in stored.read_row_group(group,use_threads=False).to_pylist():
            if record!=next(stream):raise ValueError('stored field differs from source')
            verified+=1
    if next(stream,None) is not None or verified!=rows:raise ValueError('stored row accounting mismatch')
    with part.open('rb') as f:os.fsync(f.fileno())
    part.replace(output)
    return {'rows':rows,'columns':len(fields),'bytes':output.stat().st_size,'allocated_bytes':output.stat().st_blocks*512,
            'sha256':sha(output),'all_fields_verified':True,'source_sha256':expected_sha}


def add_group(db,batch,group):
    rows=0;angular=0
    for offset,r in enumerate(batch):
        key=int(r['OID']);ra=float(r['RAdeg']) if r['RAdeg'] is not None else None
        dec=float(r['DEdeg']) if r['DEdeg'] is not None else None
        valid=ra is not None and dec is not None and math.isfinite(ra) and math.isfinite(dec) and 0<=ra<=360 and -90<=dec<=90
        if valid:ra=ra%360
        db.execute('INSERT INTO objects VALUES (?,?,?,?,?,?,?)',(key,r['Name'],ra,dec,r.get('V'),group,offset))
        if valid:db.execute('INSERT INTO angular VALUES (?,?,?,?,?)',(key,ra,ra,dec,dec));angular+=1
        rows+=1
    return rows,angular


def main(source_root,output):
    if (source_root/'OWNER').read_text()!='SkyChart isolated VSX field audit 1271\n':raise ValueError('unowned source')
    audit=json.loads((source_root/'fields.receipt.json').read_text())
    if audit['status']!='SOURCE_FIELDS_AUDITED' or audit['columns']!=21 or audit['rows']!=10304679:raise ValueError('unverified complete VSX contract')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=output/'OWNER';marker='SkyChart isolated VSX full storage 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'format':FORMAT,'source_sha256':audit['source_sha256'],'schema_sha256':audit['readme_sha256']}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('release changed')
    if sha(source_root/'ReadMe')!=audit['readme_sha256']:raise ValueError('source schema changed')
    save(output/'manifest.json',pin);started=time.time();floor=100*(1<<30)
    detail=output/'detail.parquet';receipt=output/'detail.receipt.json'
    if receipt.exists():
        measured=json.loads(receipt.read_text())
        if sha(detail)!=measured['sha256']:raise ValueError('stored data changed')
    else:
        save(output/'progress.json',{'status':'CONVERTING_AND_VERIFYING_FULL_SOURCE'})
        measured=convert(source_root/'vsx.dat.incoming',source_root/'ReadMe',detail,audit['rows'],audit['source_sha256'],floor)
        save(receipt,measured)
    index=output/'lookup.sqlite';table=pq.ParquetFile(detail)
    with sqlite3.connect(index) as db:
        db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
          CREATE TABLE IF NOT EXISTS objects(oid INTEGER PRIMARY KEY,name TEXT,ra REAL,dec REAL,variability_flag TEXT,row_group INTEGER,row_offset INTEGER);
          CREATE INDEX IF NOT EXISTS names ON objects(name COLLATE NOCASE);
          CREATE VIRTUAL TABLE IF NOT EXISTS angular USING rtree(oid,min_ra,max_ra,min_dec,max_dec);
          CREATE TABLE IF NOT EXISTS groups_done(row_group INTEGER PRIMARY KEY,rows INTEGER,angular INTEGER);''')
        for group in range(table.num_row_groups):
            if db.execute('SELECT 1 FROM groups_done WHERE row_group=?',(group,)).fetchone():continue
            guard(output,floor)
            with db:
                counts=add_group(db,table.read_row_group(group,columns=['OID','Name','RAdeg','DEdeg','V'],use_threads=False).to_pylist(),group)
                db.execute('INSERT INTO groups_done VALUES (?,?,?)',(group,*counts))
            save(output/'progress.json',{'status':'INDEXING','completed_row_groups':group+1,'expected_row_groups':table.num_row_groups})
        rows=db.execute('SELECT count(*) FROM objects').fetchone()[0];angular=db.execute('SELECT count(*) FROM angular').fetchone()[0]
        if rows!=audit['rows'] or db.execute('SELECT sum(rows),sum(angular) FROM groups_done').fetchone()!=(rows,angular):raise ValueError('global accounting mismatch')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute("SELECT rtreecheck('angular')").fetchone()[0]!='ok':raise ValueError('index integrity failed')
        for group in sorted({0,table.num_row_groups//2,table.num_row_groups-1}):
            r=table.read_row_group(group,use_threads=False).to_pylist()[0]
            if db.execute('SELECT row_group,row_offset FROM objects WHERE oid=?',(int(r['OID']),)).fetchone()!=(group,0):raise ValueError('offline hydration locator failed')
    db.close()
    result={'status':'FULL_SOURCE_DATA_AND_LOOKUP_MEASURED','format':FORMAT,'rows':rows,'angular_rows':angular,
            'detail_bytes':measured['bytes'],'detail_allocated_bytes':measured['allocated_bytes'],'detail_sha256':measured['sha256'],
            'index_bytes':index.stat().st_size,'index_allocated_bytes':index.stat().st_blocks*512,'index_sha256':sha(index),
            'offline_hydration_samples':3,'seconds':time.time()-started,'full_serving_bytes':None,
            'remaining':['bibliography associations','cross-catalog identities','angular rendering tiles','native API and latency budgets']}
    save(output/'measurement.json',result);save(output/'progress.json',{'status':result['status']});print(json.dumps(result),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_root',type=Path);p.add_argument('output',type=Path);a=p.parse_args();main(a.source_root,a.output)
