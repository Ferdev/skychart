#!/usr/bin/env python3
"""Measure lossless all-field SBDB Parquet plus global ID/name lookup.

Original decimal strings and nulls are retained without numerical coercion.
This is an isolated storage experiment, not a production catalog admission.
"""
import argparse
import fcntl
import itertools
import json
import os
from pathlib import Path
import sqlite3
import time
import ijson
import pyarrow as pa
import pyarrow.parquet as pq

from measure_gaia_full_partitions import guard, save, sha

FORMAT='sbdb-all-fields-original-types-zstd3-rg4096-v1'
INTEGER_FIELDS={'spkid','sats','n_obs_used','n_del_obs_used','n_dop_obs_used'}


def records(source, fields):
    with source.open('rb') as f:
        for row in ijson.items(f,'data.item'):
            if len(row)!=len(fields) or any(v is not None and type(v) is not (int if n in INTEGER_FIELDS else str) for n,v in zip(fields,row)):
                raise ValueError('source field type/width differs from pinned integer/string contract')
            yield row


def convert(source, output, receipt, metadata, floor):
    fields=receipt['fields']
    if sha(source)!=receipt['sha256']:raise ValueError('source changed')
    schema=pa.schema([(n,pa.int64() if n in INTEGER_FIELDS else pa.string()) for n in fields],metadata={
        b'format':FORMAT.encode(),b'source_sha256':receipt['sha256'].encode(),
        b'provider_field_metadata':metadata,
        b'precision':b'Exact upstream decimal strings, identifiers, flags and nulls; no derived physical positions'})
    part=output.with_suffix('.parquet.partial');rows=0;started=time.monotonic()
    stream=records(source,fields)
    with pq.ParquetWriter(part,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        while batch:=list(itertools.islice(stream,4096)):
            guard(output.parent,floor)
            table=pa.Table.from_arrays([pa.array(values,type=schema.field(n).type) for n,values in zip(fields,zip(*batch))],schema=schema)
            writer.write_table(table,row_group_size=4096);rows+=len(batch)
    if rows!=receipt['rows']:raise ValueError('source accounting differs')
    # Independently read source again and compare every field in every row.
    stream=records(source,fields);table=pq.ParquetFile(part);verified=0
    for group in range(table.num_row_groups):
        for record in table.read_row_group(group,use_threads=False).to_pylist():
            if [record[n] for n in fields]!=next(stream):raise ValueError('lossy stored record')
            verified+=1
    if next(stream,None) is not None or verified!=rows:raise ValueError('stored row count differs')
    with part.open('rb') as f:os.fsync(f.fileno())
    part.replace(output)
    return {'rows':rows,'columns':len(fields),'logical_bytes':output.stat().st_size,
            'allocated_bytes':output.stat().st_blocks*512,'sha256':sha(output),
            'source_sha256':receipt['sha256'],'all_fields_verified':True,'seconds':time.monotonic()-started}


def index_category(db, path, category):
    table=pq.ParquetFile(path);rows=0;aliases=0
    for group in range(table.num_row_groups):
        values=table.read_row_group(group,columns=['spkid','full_name','pdes','name'],use_threads=False).to_pylist()
        for offset,r in enumerate(values):
            key=int(r['spkid'])
            if key!=r['spkid']:raise ValueError('noncanonical SPK ID')
            db.execute('INSERT INTO objects VALUES (?,?,?,?)',(key,category,group,offset))
            for field in ['full_name','pdes','name']:
                if r[field] is not None and r[field].strip():
                    db.execute('INSERT INTO aliases VALUES (?,?,?)',(r[field],key,field));aliases+=1
            rows+=1
    return rows,aliases


def main(source_root, output, metadata):
    if (source_root/'OWNER').read_text()!='SkyChart isolated SBDB category measurement 1271\n':
        raise ValueError('unowned source')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated SBDB full-field storage 1271\n';owner=output/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    started=time.time();measurement=json.loads((source_root/'measurement.json').read_text())
    pin={'format':FORMAT,'measurement_sha256':sha(source_root/'measurement.json'),'metadata_sha256':sha(metadata)}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:
        raise ValueError('pinned source or schema changed')
    save(output/'manifest.json',pin)
    floor=100*(1<<30);receipts={};index=output/'lookup.sqlite'
    with sqlite3.connect(index) as db:
        db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
          CREATE TABLE IF NOT EXISTS objects(spkid INTEGER PRIMARY KEY,category TEXT,row_group INTEGER,row_offset INTEGER);
          CREATE TABLE IF NOT EXISTS aliases(alias TEXT COLLATE NOCASE,spkid INTEGER,field TEXT,PRIMARY KEY(alias,spkid,field)) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS files(category TEXT PRIMARY KEY,sha256 TEXT,rows INTEGER,aliases INTEGER);''')
        for category,r in measurement['categories'].items():
            if category not in {'an','au','cn','cu'}:raise ValueError('unknown category')
            save(output/'progress.json',{'status':'CONVERTING_OR_INDEXING','category':category})
            path=output/(category+'.parquet');receipt=output/(category+'.receipt.json')
            if receipt.exists():
                stored=json.loads(receipt.read_text())
                if stored['source_sha256']!=r['sha256'] or sha(path)!=stored['sha256']:
                    raise ValueError('stored category changed')
            else:
                stored=convert(source_root/category/'full.json',path,r,metadata.read_bytes(),floor)
                save(receipt,stored)
            receipts[category]=stored
            old=db.execute('SELECT sha256 FROM files WHERE category=?',(category,)).fetchone()
            if old:
                if old[0]!=stored['sha256']:raise ValueError('indexed category changed')
                continue
            guard(output,floor)
            with db:
                rows,aliases=index_category(db,path,category)
                if rows!=r['rows']:raise ValueError('index accounting differs')
                db.execute('INSERT INTO files VALUES (?,?,?,?)',(category,stored['sha256'],rows,aliases))
            guard(output,floor)
        rows=db.execute('SELECT count(*) FROM objects').fetchone()[0]
        aliases=db.execute('SELECT count(*) FROM aliases').fetchone()[0]
        expected=sum(r['rows'] for r in measurement['categories'].values())
        if rows!=expected or aliases!=db.execute('SELECT sum(aliases) FROM files').fetchone()[0]:raise ValueError('global lookup accounting differs')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('index integrity failed')
        # Hydrate selected records solely from the owned lookup and Parquet.
        for category in receipts:
            for order in ['ASC','DESC']:
                key,group,offset=db.execute('SELECT spkid,row_group,row_offset FROM objects WHERE category=? ORDER BY spkid '+order+' LIMIT 1',(category,)).fetchone()
                record=pq.ParquetFile(output/(category+'.parquet')).read_row_group(group,use_threads=False).to_pylist()[offset]
                if int(record['spkid'])!=key:raise ValueError('offline hydration failed')
    db.close()
    result={'status':'FULL_CATEGORY_DATA_AND_LOOKUP_MEASURED','format':FORMAT,'rows':rows,'alias_entries':aliases,
            'categories':receipts,'detail_bytes':sum(r['logical_bytes'] for r in receipts.values()),
            'index_bytes':index.stat().st_size,'index_allocated_bytes':index.stat().st_blocks*512,
            'index_sha256':sha(index),'offline_hydration_samples':8,'seconds':time.time()-started,
            'full_serving_bytes':None,'remaining':['native API integration','cross-catalog identity evidence',
            'dynamic ephemeris/rendering artifacts','native search latency budgets','atomic upstream snapshot semantics']}
    save(output/'measurement.json',result);save(output/'progress.json',{'status':result['status']});print(json.dumps(result),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_root',type=Path);p.add_argument('output',type=Path);p.add_argument('metadata',type=Path)
    a=p.parse_args();main(a.source_root,a.output,a.metadata)
