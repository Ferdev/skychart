#!/usr/bin/env python3
"""Measure all typed Quaia export fields and owned ID/counterpart/angular lookup."""
import argparse
import fcntl
import itertools
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import xml.etree.ElementTree as ET
import pyarrow as pa
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard,save,sha

TYPES={'long':pa.int64(),'int':pa.int32(),'double':pa.float64(),'char':pa.string()}


def records(source,fields):
    stack=[];schema=[]
    for event,element in ET.iterparse(source,events=('start','end')):
        tag=element.tag.rsplit('}',1)[-1]
        if event=='start':
            stack.append(element)
            if tag in {'BINARY','BINARY2','FITS'}:raise ValueError('unsupported source encoding')
        else:
            if tag=='FIELD':schema.append((element.get('name'),element.get('datatype')))
            if tag=='INFO' and element.get('name')=='QUERY_STATUS' and element.get('value')!='OK':raise ValueError('source query failed')
            if tag=='TR':
                if schema!=fields or len(element)!=len(fields):raise ValueError('source schema changed')
                row={}
                for (name,kind),cell in zip(fields,element):
                    value=cell.text
                    row[name]=None if value is None or value=='' else int(value) if kind in {'long','int'} else float(value) if kind=='double' else value
                stack[-2].remove(element)
                yield row
            stack.pop()


def equal(a,b):
    return a.keys()==b.keys() and all(x==b[k] or isinstance(x,float) and math.isnan(x) and isinstance(b[k],float) and math.isnan(b[k]) for k,x in a.items())


def convert(source,output,audit,floor):
    fields=[(f['attributes']['name'],f['attributes']['datatype']) for f in audit['fields']]
    schema=pa.schema([(name,TYPES[kind]) for name,kind in fields],metadata={
        b'source_fields':json.dumps(audit['fields']).encode(),b'source_sha256':audit['sha256'].encode(),
        b'coordinate_contract':b'Quaia ICRS epoch 2016.0 angular coordinates; archive x/y/z are auxiliary, not physical placement',
        b'distance_contract':b'Original redshift estimates and uncertainties retained; no distance, light-time or size inferred'})
    part=output.with_suffix('.partial');stream=records(source,fields);count=0
    with pq.ParquetWriter(part,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        while batch:=list(itertools.islice(stream,4096)):
            guard(output.parent,floor);writer.write_table(pa.Table.from_pylist(batch,schema=schema),row_group_size=4096);count+=len(batch)
    if count!=audit['rows']:raise ValueError('source row accounting mismatch')
    stream=records(source,fields);table=pq.ParquetFile(part);verified=0
    for group in range(table.num_row_groups):
        for row in table.read_row_group(group,use_threads=False).to_pylist():
            if not equal(row,next(stream)):raise ValueError('scientific field roundtrip failed')
            verified+=1
    if next(stream,None) is not None or verified!=count:raise ValueError('stored row count mismatch')
    with part.open('rb') as f:os.fsync(f.fileno())
    part.replace(output)
    return {'rows':count,'columns':len(fields),'all_fields_verified':True,'bytes':output.stat().st_size,
            'allocated_bytes':output.stat().st_blocks*512,'sha256':sha(output)}


def add_group(db,batch,group):
    angular=0
    for offset,row in enumerate(batch):
        key=row['source_id'];ra=row['ra'];dec=row['dec']
        if key is None:raise ValueError('missing source ID')
        db.execute('INSERT INTO objects VALUES (?,?,?,?,?,?)',(key,row['unwise_objid'],ra,dec,group,offset))
        valid=ra is not None and dec is not None and math.isfinite(ra) and math.isfinite(dec) and 0<=ra<360 and -90<=dec<=90
        if valid:
            db.execute('INSERT INTO angular VALUES (?,?,?,?,?)',(key,ra,ra,dec,dec));angular+=1
    return len(batch),angular


def measure(source_root,output):
    audit=json.loads((source_root/'receipt.json').read_text());source=source_root/'full-source.xml'
    if audit['status']!='complete_TABLEDATA_source_audited' or audit['rows']!=1295502 or audit['columns']!=24:raise ValueError('full source audit required')
    if sha(source)!=audit['sha256']:raise ValueError('source checksum changed')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=output/'OWNER';marker='SkyChart isolated Quaia storage 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'source_sha256':audit['sha256'],'format':'quaia-all24-typed-zstd3-rg4096-v1'}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('release changed')
    save(output/'manifest.json',pin);floor=100<<30;started=time.monotonic()
    detail=output/'detail.parquet';detail_receipt=output/'detail.receipt.json'
    if detail_receipt.exists():
        stored=json.loads(detail_receipt.read_text())
        if sha(detail)!=stored['sha256']:raise ValueError('stored detail changed')
    else:
        save(output/'progress.json',{'status':'CONVERTING_AND_VERIFYING_ALL_FIELDS'})
        stored=convert(source,detail,audit,floor);save(detail_receipt,stored)
    table=pq.ParquetFile(detail);index=output/'lookup.sqlite'
    if (output/'measurement.json').exists():
        result=json.loads((output/'measurement.json').read_text())
        if sha(index)!=result['index_sha256']:raise ValueError('stored index changed')
        return result
    with sqlite3.connect(index) as db:
        db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
        CREATE TABLE IF NOT EXISTS objects(source_id INTEGER PRIMARY KEY,unwise_objid TEXT,ra REAL,dec REAL,row_group INTEGER,row_offset INTEGER);
        CREATE INDEX IF NOT EXISTS counterparts ON objects(unwise_objid);
        CREATE VIRTUAL TABLE IF NOT EXISTS angular USING rtree(source_id,min_ra,max_ra,min_dec,max_dec);
        CREATE TABLE IF NOT EXISTS groups_done(row_group INTEGER PRIMARY KEY,rows INTEGER,angular INTEGER);''')
        for group in range(table.num_row_groups):
            if db.execute('SELECT 1 FROM groups_done WHERE row_group=?',(group,)).fetchone():continue
            guard(output,floor)
            with db:
                counts=add_group(db,table.read_row_group(group,columns=['source_id','unwise_objid','ra','dec'],use_threads=False).to_pylist(),group)
                db.execute('INSERT INTO groups_done VALUES (?,?,?)',(group,*counts))
            save(output/'progress.json',{'status':'INDEXING','completed_groups':group+1,'expected_groups':table.num_row_groups})
        rows=db.execute('SELECT count(*) FROM objects').fetchone()[0];angular=db.execute('SELECT count(*) FROM angular').fetchone()[0]
        if rows!=audit['rows'] or db.execute('SELECT sum(rows),sum(angular) FROM groups_done').fetchone()!=(rows,angular):raise ValueError('global row accounting failed')
        if db.execute('PRAGMA integrity_check').fetchone()!=('ok',) or db.execute("SELECT rtreecheck('angular')").fetchone()!=('ok',):raise ValueError('index integrity failed')
        enclosed=db.execute('SELECT count(*) FROM objects o JOIN angular a ON o.source_id=a.source_id WHERE a.min_ra<=o.ra AND a.max_ra>=o.ra AND a.min_dec<=o.dec AND a.max_dec>=o.dec').fetchone()[0]
        if enclosed!=angular:raise ValueError('angular bounds omit source positions')
        samples=0
        for group in range(table.num_row_groups):
            row=table.read_row_group(group,use_threads=False).to_pylist()[0]
            if db.execute('SELECT row_group,row_offset FROM objects WHERE source_id=?',(row['source_id'],)).fetchone()!=(group,0):raise ValueError('offline locator mismatch')
            samples+=1
    result={'status':'FULL_TYPED_RECORDS_AND_LOOKUP_COMPONENT_MEASURED','rows':rows,'angular_rows':angular,
            'detail_bytes':stored['bytes'],'detail_sha256':stored['sha256'],'index_bytes':index.stat().st_size,
            'index_allocated_bytes':index.stat().st_blocks*512,'index_sha256':sha(index),'offline_hydration_samples':samples,
            'seconds':time.monotonic()-started,'full_serving_bytes':None,
            'remaining':['selection-function products','native API and query budgets','cross-catalog identity evidence','native angular/physical rendering artifacts']}
    save(output/'measurement.json',result);save(output/'progress.json',{'status':result['status']});return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_root',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    print(json.dumps(measure(a.source_root,a.output)))
