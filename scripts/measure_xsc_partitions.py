#!/usr/bin/env python3
"""Measure a pinned XSC-format artifact candidate in investigation-owned scratch.

No production integration or source-release admission. All 389 source columns
are retained; official 'real' columns use float64 to avoid extra quantization.
"""
import argparse
import gzip
import hashlib
import itertools
import json
from pathlib import Path
import re
import resource
import sqlite3
import sys
import time

import pyarrow as pa
import pyarrow.parquet as pq
from investigate_catalog_storage import check, footprint, timing


def run(inputs, schema_path, output, limit, max_seconds=600):
    if limit<0 or not 1<=max_seconds<=1200:
        raise ValueError('explicit bounded record/time limits required')
    output.mkdir(parents=True,exist_ok=False)
    fields=re.findall(r'^\s+(\w+) (double precision|real|smallint|integer|date|character\(\d+\))[,\n]',schema_path.read_text(),re.M)
    if len(fields)!=389:
        raise ValueError('pinned XSC schema must have 389 columns')
    schema=pa.schema([(name,pa.float64() if kind in ('real','double precision') else
                      pa.int16() if kind=='smallint' else pa.int32() if kind=='integer' else pa.string())
                     for name,kind in fields],metadata={b'source_schema_sha256':hashlib.file_digest(schema_path.open('rb'),'sha256').hexdigest().encode(),
                                                      b'encoding':b'xsc-all-columns-f64-v1'})
    db=sqlite3.connect(output/'lookup.sqlite')
    db.executescript('''PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
      CREATE TABLE lookup (ext_key INTEGER PRIMARY KEY, designation TEXT NOT NULL,
        ra REAL NOT NULL, dec REAL NOT NULL, partition INTEGER NOT NULL, row_group INTEGER NOT NULL, row_offset INTEGER NOT NULL);
      CREATE VIRTUAL TABLE angular USING rtree(ext_key,min_ra,max_ra,min_dec,max_dec);
    ''')
    start=time.monotonic(); count=0; partitions=[]; writer=None; batch=[]; part_count=0
    high=footprint(output.parent); first_records=[]; completed_inputs=[]
    totals={key:0 for key in ('ext_key','use_src','dup_src','pts_key')}
    def checkpoint():
        nonlocal high
        size=check(output.parent)
        for key in high: high[key]=max(high[key],size[key])
        if time.monotonic()-start>max_seconds:
            raise TimeoutError('exploratory build time budget reached; no full-release claim')
    def flush():
        nonlocal batch,writer,part_count
        if not batch:return
        if writer is None:
            path=output/f'part-{len(partitions):05d}.parquet'
            writer=pq.ParquetWriter(path,schema,compression='zstd',compression_level=3,write_statistics=True)
            partitions.append({'name':path.name,'rows':0})
            part_count=0
        table=pa.Table.from_pylist(batch,schema=schema)
        writer.write_table(table,row_group_size=1024)
        part=len(partitions)-1
        for index,row in enumerate(batch):
            db.execute('INSERT INTO lookup VALUES (?,?,?,?,?,?,?)',
                       (row['ext_key'],row['designation'],row['ra'],row['decl'],part,part_count//1024,index))
            db.execute('INSERT INTO angular VALUES (?,?,?,?,?)',
                       (row['ext_key'],row['ra'],row['ra'],row['decl'],row['decl']))
        db.commit()
        part_count+=len(batch); partitions[-1]['rows']+=len(batch); batch=[]
        if part_count>=16384:
            writer.close();writer=None
            (output/'progress.json').write_text(json.dumps({'state':'unadmitted_incomplete',
                'closed_partitions':partitions,'processed_rows':count})+'\n')
            if count%65536==0:
                print(json.dumps({'processed_rows':count,'elapsed_seconds':round(time.monotonic()-start,2),
                                  'scratch':footprint(output.parent)}),file=sys.stderr,flush=True)
        checkpoint()
    try:
        for source in inputs:
            seen=0
            with gzip.open(source,'rt') as stream:
                selected=itertools.islice(stream,limit-count) if limit else stream
                for line in selected:
                    values=line.rstrip('\n').split('|')
                    if len(values)!=len(fields):raise ValueError('column count drift')
                    row={}
                    for (name,kind),value in zip(fields,values):
                        row[name]=None if value=='\\N' else float(value) if kind in ('real','double precision') else int(value) if kind in ('smallint','integer') else value
                    if not 0<=row['ra']<360 or not -90<=row['decl']<=90:
                        raise ValueError('angular coordinates invalid')
                    if len(first_records)<3:first_records.append(row)
                    for key in totals:totals[key]+=row[key] or 0
                    batch.append(row);count+=1;seen+=1
                    if len(batch)==1024:flush()
            completed_inputs.append({'name':source.name,'processed_rows':seen,'full_gzip_verified':not bool(limit),
                                     'bytes':source.stat().st_size,
                                     'sha256':hashlib.file_digest(source.open('rb'),'sha256').hexdigest()})
            if limit and count>=limit:break
        flush()
        if writer:writer.close();writer=None
        before=footprint(output)
        index_start=time.monotonic()
        db.executescript('CREATE INDEX designation_index ON lookup(designation); ANALYZE;')
        db.commit();checkpoint()
        index_seconds=time.monotonic()-index_start
        verified_rows=0
        for part in partitions:
            path=output/part['name'];file=pq.ParquetFile(path)
            assert file.metadata.num_rows==part['rows']
            verified_rows+=file.metadata.num_rows
            part.update(bytes=path.stat().st_size,allocated_bytes=path.stat().st_blocks*512,
                        sha256=hashlib.file_digest(path.open('rb'),'sha256').hexdigest())
        assert verified_rows==count==db.execute('SELECT count(*) FROM lookup').fetchone()[0]
        build_seconds=time.monotonic()-start
        queries=[]
        for row in first_records:
            def lookup():
                loc=db.execute('SELECT partition,row_group,row_offset FROM lookup WHERE ext_key=?',(row['ext_key'],)).fetchone()
                p,g,i=loc
                actual=pq.ParquetFile(output/partitions[p]['name']).read_row_group(g).slice(i,1).to_pylist()[0]
                assert actual==row
            queries.append({'ext_key':row['ext_key'],'owned_detail':timing(lookup,repeats=5)})
        pages=list(db.execute('SELECT name,sum(pgsize) FROM dbstat GROUP BY name'))
        db.close();checkpoint()
        result={'schema_version':1,'encoding':'xsc-all-columns-f64-v1','scope':'bounded source prefix' if limit else 'provided complete gzip files; reconcile entire release separately',
                'fields':len(fields),'rows':count,'source_verification_sums':totals,'inputs':completed_inputs,'partitions':partitions,
                'before_designation_index':before,'final_artifacts':footprint(output),
                'sqlite_pages':pages,'index_build_seconds':index_seconds,'build_seconds_before_queries':build_seconds,'elapsed_seconds':time.monotonic()-start,
                'observed_checkpoint_high_water':high,'peak_sampling':'batch/phase checkpoints; instantaneous peak unmeasured',
                'max_process_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'queries_warm_local_library_only':queries,
                'coverage_admitted':False,'unknowns':['full release when prefix-limited','aliases/crossmatches','native integration and rendering',
                                                    'cold/concurrent/network query latency','backup storage','exact instantaneous build peak']}
        (output/'measurement.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
    finally:
        if writer:writer.close()
        db.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--schema',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--limit',type=int,default=5000,help='0 processes all supplied files after feasibility review')
    p.add_argument('--max-seconds',type=int,default=600)
    p.add_argument('inputs',type=Path,nargs='+')
    a=p.parse_args()
    print(json.dumps(run(a.inputs,a.schema,a.output,a.limit,a.max_seconds),indent=2))
