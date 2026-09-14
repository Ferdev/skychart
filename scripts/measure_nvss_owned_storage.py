#!/usr/bin/env python3
"""Measure every NVSS field and source-record/name/angular lookup.

Raw source strings preserve measurement precision and flags. Ordinals are
release-specific record locators, never established physical object identities.
"""
import argparse
import fcntl
import gzip
import itertools
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import pyarrow as pa
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard,save,sha


def records(source,fields):
    width=max(f['end'] for f in fields)
    with gzip.open(source,'rb') as stream:
        for line in stream:
            raw=line.rstrip(b'\r\n')
            if len(raw)>width:raise ValueError('source exceeds schema width')
            raw=raw.ljust(width,b' ')
            yield {f['name']:(raw[f['start']-1:f['end']].strip().decode('ascii') or None) for f in fields}


def position(row):
    keys=['RAh','RAm','RAs','DE-','DEd','DEm','DEs']
    if any(row[k] is None for k in keys):return None,None,'unknown'
    h,m,s,d,dm,ds=[float(row[k]) for k in ['RAh','RAm','RAs','DEd','DEm','DEs']]
    if not all(math.isfinite(v) for v in [h,m,s,d,dm,ds]) or row['DE-'] not in ['+','-']:
        return None,None,'invalid'
    # The pinned CDS model permits seconds == 60 due to source rounding.
    if not (0<=h<=24 and 0<=m<60 and 0<=s<=60 and 0<=d<=90 and 0<=dm<60 and 0<=ds<=60):
        return None,None,'invalid'
    ra=15*(h+m/60+s/3600);dec=d+dm/60+ds/3600
    if ra>360 or dec>90:return None,None,'invalid'
    return ra%360,(-1 if row['DE-']=='-' else 1)*dec,'angular'


def convert(source,readme,output,audit,floor):
    fields=audit['schema']
    schema=pa.schema([(f['name'],pa.string()) for f in fields],metadata={
        b'source_readme':readme.read_bytes(),b'source_sha256':audit['source_sha256'].encode(),
        b'source_schema':json.dumps(fields).encode(),
        b'normalization':b'Trailing omitted positions padded for field access; trimmed blanks become null; all measurement text, radio units and flags retained'})
    stream=records(source,fields);part=output.with_suffix('.partial');count=0
    with pq.ParquetWriter(part,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        while batch:=list(itertools.islice(stream,4096)):
            guard(output.parent,floor);writer.write_table(pa.Table.from_pylist(batch,schema=schema),row_group_size=4096);count+=len(batch)
    if count!=audit['rows']:raise ValueError('full row count mismatch')
    table=pq.ParquetFile(part);stream=records(source,fields);verified=0
    for group in range(table.num_row_groups):
        for row in table.read_row_group(group,use_threads=False).to_pylist():
            if row!=next(stream):raise ValueError('source scientific field changed')
            verified+=1
    if next(stream,None) is not None or verified!=count:raise ValueError('verification count mismatch')
    with part.open('rb') as f:os.fsync(f.fileno())
    part.replace(output)
    return {'rows':count,'columns':len(fields),'all_fields_verified':True,'bytes':output.stat().st_size,
            'allocated_bytes':output.stat().st_blocks*512,'sha256':sha(output)}


def add_group(db,batch,group):
    counts={'angular':0,'unknown':0,'invalid':0}
    for offset,row in enumerate(batch):
        ordinal=group*4096+offset+1
        if not row['NVSS']:raise ValueError('missing source name')
        ra,dec,kind=position(row);counts[kind]+=1
        db.execute('INSERT INTO objects VALUES (?,?,?,?,?,?)',(ordinal,'NVSS J'+row['NVSS'],ra,dec,group,offset))
        if kind=='angular':db.execute('INSERT INTO angular VALUES (?,?,?,?,?)',(ordinal,ra,ra,dec,dec))
    return len(batch),counts['angular'],counts['unknown'],counts['invalid']


def measure(source_root,output):
    audit=json.loads((source_root/'fields.receipt.json').read_text());source=source_root/'source.gz';readme=source_root/'ReadMe'
    if audit['status']!='SOURCE_FIELDS_AUDITED' or audit['rows']!=1773484 or audit['columns']!=29:raise ValueError('full field audit required')
    if sha(source)!=audit['source_sha256'] or sha(readme)!=audit['readme_sha256']:raise ValueError('source or schema changed')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated NVSS full storage 1271\n';owner=output/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'source_sha256':audit['source_sha256'],'readme_sha256':audit['readme_sha256'],
         'format':'nvss-all29-source-text-zstd3-rg4096-v1','position_contract':'Source J2000 equinox centroids; observation epoch 1995 +/- 2; angular only'}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('release changed')
    save(output/'manifest.json',pin);started=time.monotonic();floor=100<<30
    detail=output/'detail.parquet';detail_receipt=output/'detail.receipt.json'
    if detail_receipt.exists():
        stored=json.loads(detail_receipt.read_text())
        if sha(detail)!=stored['sha256']:raise ValueError('detail changed')
    else:
        save(output/'progress.json',{'status':'CONVERTING_AND_VERIFYING_ALL_FIELDS'})
        stored=convert(source,readme,detail,audit,floor);save(detail_receipt,stored)
    index=output/'lookup.sqlite';table=pq.ParquetFile(detail)
    if (output/'measurement.json').exists():
        r=json.loads((output/'measurement.json').read_text())
        if sha(index)!=r['index_sha256']:raise ValueError('completed index changed')
        return r
    with sqlite3.connect(index) as db:
        db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
        CREATE TABLE IF NOT EXISTS objects(ordinal INTEGER PRIMARY KEY,name TEXT NOT NULL,ra REAL,dec REAL,row_group INTEGER,row_offset INTEGER);
        CREATE INDEX IF NOT EXISTS names ON objects(name);
        CREATE VIRTUAL TABLE IF NOT EXISTS angular USING rtree(ordinal,min_ra,max_ra,min_dec,max_dec);
        CREATE TABLE IF NOT EXISTS groups_done(row_group INTEGER PRIMARY KEY,rows INTEGER,angular INTEGER,unknown INTEGER,invalid INTEGER);''')
        for group in range(table.num_row_groups):
            if db.execute('SELECT 1 FROM groups_done WHERE row_group=?',(group,)).fetchone():continue
            guard(output,floor)
            with db:
                batch=table.read_row_group(group,columns=['NVSS','RAh','RAm','RAs','DE-','DEd','DEm','DEs'],use_threads=False).to_pylist()
                counts=add_group(db,batch,group);db.execute('INSERT INTO groups_done VALUES (?,?,?,?,?)',(group,*counts))
            save(output/'progress.json',{'status':'INDEXING','completed_groups':group+1,'expected_groups':table.num_row_groups})
        rows,angular,unknown,invalid=db.execute('SELECT sum(rows),sum(angular),sum(unknown),sum(invalid) FROM groups_done').fetchone()
        if rows!=audit['rows'] or rows!=angular+unknown+invalid or db.execute('SELECT count(*) FROM objects').fetchone()[0]!=rows or db.execute('SELECT count(*) FROM angular').fetchone()[0]!=angular:raise ValueError('global count mismatch')
        if db.execute('PRAGMA integrity_check').fetchone()!=('ok',) or db.execute("SELECT rtreecheck('angular')").fetchone()!=('ok',):raise ValueError('index integrity failed')
        enclosed=db.execute('SELECT count(*) FROM objects o JOIN angular a ON o.ordinal=a.ordinal WHERE a.min_ra<=o.ra AND a.max_ra>=o.ra AND a.min_dec<=o.dec AND a.max_dec>=o.dec').fetchone()[0]
        if enclosed!=angular:raise ValueError('angular bounds omit source positions')
        distinct_names=db.execute('SELECT count(DISTINCT name) FROM objects').fetchone()[0]
        samples=0
        for group in range(table.num_row_groups):
            row=table.read_row_group(group,columns=['NVSS'],use_threads=False).to_pylist()[0]
            if db.execute('SELECT name,row_group,row_offset FROM objects WHERE ordinal=?',(group*4096+1,)).fetchone()!=('NVSS J'+row['NVSS'],group,0):raise ValueError('offline locator failed')
            samples+=1
    result={'status':'FULL_RECORDS_AND_NAME_ANGULAR_COMPONENT_MEASURED','rows':rows,'angular_rows':angular,
            'unknown_angular_rows':unknown,'invalid_angular_rows':invalid,'distinct_source_names':distinct_names,
            'detail_bytes':stored['bytes'],'detail_sha256':stored['sha256'],'index_bytes':index.stat().st_size,
            'index_allocated_bytes':index.stat().st_blocks*512,'index_sha256':sha(index),'offline_hydration_samples':samples,
            'seconds':time.monotonic()-started,'full_serving_bytes':None,
            'remaining':['native query/API integration and budgets','cross-catalog component/identity evidence','native angular rendering artifacts']}
    save(output/'measurement.json',result);save(output/'progress.json',{'status':result['status']});return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_root',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    print(json.dumps(measure(a.source_root,a.output)))
