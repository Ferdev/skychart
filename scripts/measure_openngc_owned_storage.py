#!/usr/bin/env python3
"""Measure a pinned complete OpenNGC release and exact-name routing component."""
import argparse
import csv
import fcntl
import itertools
import json
import os
from pathlib import Path
import sqlite3
import time
import pyarrow as pa
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard,save,sha


def records(source,columns):
    with source.open(newline='',encoding='utf-8') as f:
        reader=csv.DictReader(f,delimiter=';')
        if reader.fieldnames!=columns:raise ValueError('source schema changed')
        for row in reader:
            if None in row or any(value is None for value in row.values()):raise ValueError('malformed source row')
            yield row


def measure(source,guide,output,contract):
    if sha(source)!=contract['sha256']:raise ValueError('source checksum mismatch')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=output/'OWNER';marker='SkyChart isolated OpenNGC storage 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'source_sha256':contract['sha256'],'guide_sha256':sha(guide),
         'rows':contract['rows'],'columns':contract['columns'],'release_commit':contract['release_commit']}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('release changed')
    save(output/'manifest.json',pin)
    if (output/'measurement.json').exists():
        receipt=json.loads((output/'measurement.json').read_text())
        for name in ['detail.parquet','lookup.sqlite']:
            if sha(output/name)!=receipt['files'][name]['sha256']:raise ValueError('measured artifact changed')
        return receipt
    started=time.monotonic();guard(output,100<<30)
    schema=pa.schema([(name,pa.string()) for name in contract['columns']],metadata={
        b'source_contract':json.dumps(pin).encode(),b'source_guide':guide.read_bytes(),
        b'normalization':b'Original CSV strings, including blanks; no physical distance or identity inference'})
    detail=output/'detail.parquet';part=output/'detail.partial';stream=records(source,contract['columns']);count=0
    with pq.ParquetWriter(part,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        while batch:=list(itertools.islice(stream,1024)):
            writer.write_table(pa.Table.from_pylist(batch,schema=schema),row_group_size=1024);count+=len(batch)
    if count!=contract['rows']:raise ValueError('source count differs from pinned release')
    table=pq.ParquetFile(part);stream=records(source,contract['columns']);index=output/'lookup.partial'
    # A failed trial may leave only these uncommitted, builder-owned artifacts.
    index.unlink(missing_ok=True)
    with sqlite3.connect(index) as db:
        db.execute('CREATE TABLE objects (name TEXT PRIMARY KEY, row_group INTEGER NOT NULL, row_offset INTEGER NOT NULL) WITHOUT ROWID')
        verified=0
        for group in range(table.num_row_groups):
            for offset,row in enumerate(table.read_row_group(group,use_threads=False).to_pylist()):
                if row!=next(stream):raise ValueError('stored scientific field changed')
                if not row['Name']:raise ValueError('missing record name')
                db.execute('INSERT INTO objects VALUES (?,?,?)',(row['Name'],group,offset));verified+=1
        if next(stream,None) is not None or verified!=count:raise ValueError('record accounting mismatch')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise ValueError('index integrity failure')
        routed=0
        # Verify every source record resolves to its complete local detail.
        groups={}
        for row in records(source,contract['columns']):
            group,offset=db.execute('SELECT row_group,row_offset FROM objects WHERE name=?',(row['Name'],)).fetchone()
            if group not in groups:groups={group:table.read_row_group(group,use_threads=False).to_pylist()}
            if groups[group][offset]!=row:raise ValueError('offline hydration mismatch')
            routed+=1
    del table
    for path,target in [(part,detail),(index,output/'lookup.sqlite')]:
        with path.open('rb') as f:os.fsync(f.fileno())
        path.replace(target)
    receipt={'status':'FULL_RECORDS_AND_EXACT_NAME_COMPONENT_MEASURED','rows':count,'columns':len(contract['columns']),
             'source_sha256':contract['sha256'],'all_fields_verified':verified,'offline_hydrations_verified':routed,
             'seconds':time.monotonic()-started,'files':{},'full_serving_bytes':None,
             'remaining':['alias and cross-identification evidence','angular index and rendering','native integration and performance budgets']}
    for name in ['detail.parquet','lookup.sqlite']:
        path=output/name
        receipt['files'][name]={'bytes':path.stat().st_size,'allocated_bytes':path.stat().st_blocks*512,'sha256':sha(path)}
    save(output/'measurement.json',receipt)
    return receipt


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_root',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();contracts=json.loads((a.source_root/'receipt.json').read_text())
    contract=next(r for r in contracts if r['file']=='database_files/NGC.csv')
    guide=next(r for r in contracts if r['file']=='NGC_guide.txt')
    if sha(a.source_root/'NGC_guide.txt')!=guide['sha256']:raise ValueError('guide changed')
    print(json.dumps(measure(a.source_root/'NGC.csv',a.source_root/'NGC_guide.txt',a.output,contract)))
