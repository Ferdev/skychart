#!/usr/bin/env python3
"""Measure a full exact-field SQLite lookup over verified FITS, CDS or VOTable data.

Keys are field-scoped decoded values, not asserted physical identities. Nulls
have no lookup entry; numeric source sentinels retain their original values.
"""
import argparse
import fcntl
import json
from pathlib import Path
import sqlite3
import time
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard,save,sha


def key(value):
    if value is None:return None
    if isinstance(value,str):return 's:'+value
    if isinstance(value,int) and not isinstance(value,bool):return 'i:'+str(value)
    raise ValueError('exact lookup supports only scalar strings and integers')


def entries(table,fields,hdu,group):
    for offset,row in enumerate(table.to_pylist()):
        for field in fields:
            value=key(row[field])
            if value is not None:yield (field,value,hdu,group,offset)


def detail_tables(audit):
    if audit['status']=='FULL_FITS_TABLE_DATA_COMPONENT_MEASURED':return audit['tables']
    if audit['status']=='FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED':
        parts=sorted(audit['partitions'],key=lambda r:(r['hdu'],r['source_start']))
        ends={};files=set();tables=[]
        for slot,part in enumerate(parts):
            hdu=part['hdu'];start=part['source_start'];stop=part['source_stop']
            if start!=ends.get(hdu,0) or stop<start or stop-start!=part['rows'] or part['file'] in files:
                raise ValueError('partition routing has gaps, overlaps or duplicate files')
            if hdu in ends and (ends[hdu]==0 or stop==start):raise ValueError('partition routing has duplicate empty partition')
            ends[hdu]=stop;files.add(part['file'])
            # SQLite's historical hdu column is a locator slot here. Preserve
            # the actual FITS HDU and source interval in the owned routing map.
            tables.append({**part,'hdu':slot,'source_hdu':hdu})
        if sum(t['rows'] for t in tables)!=audit['rows'] or audit['rows']!=audit['expected_rows']:
            raise ValueError('partition routing row accounting mismatch')
        return tables
    if audit['status'] in {'FULL_CDS_TABLE_DATA_COMPONENT_MEASURED','FULL_SCALAR_VOTABLE_DATA_COMPONENT_MEASURED','FULL_TDAT_TABLE_DATA_COMPONENT_MEASURED'}:
        # Slot zero identifies the sole table; it is not a FITS HDU claim.
        return [{'hdu':0,'file':'detail.parquet','rows':audit['rows'],
                 'all_fields_verified':audit['all_fields_verified'],'sha256':audit['sha256']}]
    raise ValueError('verified full table required')


def measure(source,output,fields):
    if not fields or len(fields)!=len(set(fields)):raise ValueError('distinct fields required')
    audit=json.loads((source/'measurement.json').read_text())
    tables=detail_tables(audit)
    for table in tables:
        if not table['all_fields_verified'] or sha(source/table['file'])!=table['sha256']:raise ValueError('verified detail changed')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=output/'OWNER';marker='SkyChart isolated exact FITS lookup 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'receipt_sha256':sha(source/'measurement.json'),'fields':fields,'format':'field-typed-exact-sqlite-v1'}
    routing=None
    if audit['status']=='FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED':
        routing={'format':'fits-partition-locator-slots-v1','source_sha256':audit['source_sha256'],
                 'slots':[{'slot':t['hdu'],'source_hdu':t['source_hdu'],'source_start':t['source_start'],
                           'source_stop':t['source_stop'],'file':t['file'],'sha256':t['sha256']} for t in tables]}
        pin['format']='field-typed-exact-sqlite-partition-routing-v1'
    manifest=output/'manifest.json'
    if manifest.exists() and json.loads(manifest.read_text())!=pin:raise ValueError('lookup contract changed')
    save(manifest,pin);index=output/'lookup.sqlite';started=time.monotonic()
    routing_path=output/'partition-routing.json'
    if routing is not None:
        if routing_path.exists():
            if json.loads(routing_path.read_text())!=routing:raise ValueError('partition routing changed')
        else:
            if (output/'measurement.json').exists():raise ValueError('completed partition routing missing')
            save(routing_path,routing)
    if (output/'measurement.json').exists():
        result=json.loads((output/'measurement.json').read_text())
        if sha(index)!=result['sha256']:raise ValueError('completed lookup changed')
        if routing is not None and sha(routing_path)!=result['routing_sha256']:raise ValueError('completed routing changed')
        return result
    expected=0;rows=0
    with sqlite3.connect(index) as db:
        db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
        CREATE TABLE IF NOT EXISTS lookup(field TEXT,value TEXT,hdu INTEGER,rg INTEGER,off INTEGER,
          PRIMARY KEY(field,value,hdu,rg,off)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS completed(hdu INTEGER,rg INTEGER,PRIMARY KEY(hdu,rg));''')
        for receipt in tables:
            hdu=receipt['hdu'];table=pq.ParquetFile(source/receipt['file'])
            if any(field not in table.schema_arrow.names for field in fields):raise ValueError('missing lookup field')
            for group in range(table.num_row_groups):
                guard(output,100<<30)
                batch=table.read_row_group(group,columns=fields,use_threads=False)
                values=list(entries(batch,fields,hdu,group));expected+=len(values);rows+=batch.num_rows
                if not db.execute('SELECT 1 FROM completed WHERE hdu=? AND rg=?',(hdu,group)).fetchone():
                    with db:
                        db.executemany('INSERT INTO lookup VALUES (?,?,?,?,?)',values)
                        db.execute('INSERT INTO completed VALUES (?,?)',(hdu,group))
                # Verify every field/value locator, including resumed groups and repeated IDs.
                for value in values:
                    if db.execute('SELECT 1 FROM lookup WHERE field=? AND value=? AND hdu=? AND rg=? AND off=?',value).fetchone()!=(1,):
                        raise ValueError('exact locator verification failed')
                if group%64==0:save(output/'progress.json',{'status':'BUILDING_AND_VERIFYING_EXACT_LOOKUP','hdu':hdu,'group':group,'rows_verified':rows})
        if rows!=sum(t['rows'] for t in tables):raise ValueError('detail count mismatch')
        if db.execute('SELECT count(*) FROM lookup').fetchone()[0]!=expected:raise ValueError('global lookup count mismatch')
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise ValueError('SQLite integrity failed')
    result={'status':'FULL_EXACT_FIELD_LOOKUP_MEASURED','rows':rows,'entries':expected,'fields':fields,
            'bytes':index.stat().st_size,'allocated_bytes':index.stat().st_blocks*512,'sha256':sha(index),
            'seconds_current_invocation':time.monotonic()-started,'all_locators_verified':True,
            'full_serving_bytes':None,'remaining':['angular and rendering artifacts','identity evidence interpretation','native API integration and budgets']}
    if routing is not None:
        result.update(routing_bytes=routing_path.stat().st_size,routing_allocated_bytes=routing_path.stat().st_blocks*512,
                      routing_sha256=sha(routing_path),routing_file=routing_path.name,
                      index_and_routing_bytes=index.stat().st_size+routing_path.stat().st_size)
    save(output/'measurement.json',result);save(output/'progress.json',{'status':result['status']});return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('fields',nargs='+');a=p.parse_args()
    print(json.dumps(measure(a.source,a.output,a.fields)))
