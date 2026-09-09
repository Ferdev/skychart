#!/usr/bin/env python3
"""Bounded task-local experiment, not a production importer or sizing extrapolator.

Uses existing snapshot records without inventing extra rows. Preserves all source
fields in typed Parquet and builds an isolated SQLite lookup/alias/angular index.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import shutil
import sqlite3
import statistics
import threading
import time

import pyarrow as pa
import pyarrow.parquet as pq

CAP = 3584 * 1024**2  # Reserve another 512 MiB for the isolated Postgres database.
FLOOR = 200 * 1024**3


def footprint(root):
    sizes = []
    for p in root.rglob('*'):
        try:
            if p.is_file(): sizes.append(p.stat())
        except FileNotFoundError:
            pass  # SQLite can remove a journal between directory scan and stat.
    return {'logical_bytes': sum(s.st_size for s in sizes),
            'allocated_bytes': sum(s.st_blocks * 512 for s in sizes)}


def decode(table, fields):
    return [{key:r[key] for bit,key in enumerate(fields) if r['__present'] & (1<<bit)}
            for r in table.to_pylist()]


def check(root):
    size = footprint(root)
    if size['allocated_bytes'] > CAP or shutil.disk_usage(root).free < FLOOR:
        raise RuntimeError('investigation disk cap/headroom reached')
    return size


def timing(fn, repeats=30):
    durations = []
    for _ in range(repeats):
        start = time.perf_counter()
        fn()
        durations.append((time.perf_counter()-start)*1000)
    return {'repeats': repeats, 'median_ms': statistics.median(durations),
            'p95_ms': sorted(durations)[math.ceil(.95*len(durations))-1],
            'max_ms': max(durations)}


def run(snapshot, root):
    if snapshot.stat().st_size > 128*1024**2:
        raise ValueError('bounded snapshot required')
    root.mkdir(parents=True, exist_ok=False)  # Never overwrite existing artifacts.
    parent = root.parent
    check(parent)
    rows = json.loads(snapshot.read_text())['stars']
    if len(rows) > 100_000:
        raise ValueError('at most 100000 original records per sample experiment')
    rows.sort(key=lambda r: r['source_id'])
    if len({r['source_id'] for r in rows}) != len(rows):
        raise ValueError('duplicate IDs must be resolved explicitly')
    start = time.monotonic()
    high = {'logical_bytes': 0, 'allocated_bytes': 0}
    stop = threading.Event()
    def monitor():
        while not stop.wait(.1):
            current = footprint(parent)
            for key in high:
                high[key] = max(high[key], current[key])
    watcher = threading.Thread(target=monitor, daemon=True)
    watcher.start()
    db = sqlite3.connect(root/'lookup.sqlite')
    db.execute('PRAGMA cache_size=-8192')
    db.execute('PRAGMA temp_store=FILE')
    db.execute('PRAGMA journal_mode=DELETE')
    db.executescript('''
    CREATE TABLE lookup (ordinal INTEGER PRIMARY KEY, source_id TEXT NOT NULL,
      name TEXT NOT NULL, ra REAL NOT NULL, dec REAL NOT NULL,
      partition INTEGER NOT NULL, row_group INTEGER NOT NULL, row_offset INTEGER NOT NULL);
    CREATE TABLE aliases (alias TEXT NOT NULL, ordinal INTEGER NOT NULL);
    CREATE VIRTUAL TABLE angular USING rtree(ordinal,min_ra,max_ra,min_dec,max_dec);
    ''')
    partitions=[]
    try:
        fields=sorted({key for row in rows for key in row})
        if len(fields)>63 or '__present' in fields:
            raise ValueError('presence bitmap schema requires an explicit wider encoding')
        prepared=[dict({key:r.get(key) for key in fields},
                       __present=sum(1<<bit for bit,key in enumerate(fields) if key in r)) for r in rows]
        schema=pa.Table.from_pylist(prepared).schema.with_metadata(
            {b'original_fields':json.dumps(fields).encode(), b'encoding':b'presence-bitmap-v1'})
        for offset in range(0,len(rows),4096):
            if time.monotonic()-start > 600:
                raise TimeoutError('ten-minute exploratory build budget reached')
            part_rows=rows[offset:offset+4096]
            part=len(partitions)
            path=root/f'detail-{part:04d}.parquet'
            table=pa.Table.from_pylist(prepared[offset:offset+4096], schema=schema)
            pq.write_table(table,path,compression='zstd',compression_level=3,
                           row_group_size=1024,write_statistics=True)
            restored=decode(pq.read_table(path),fields)
            if restored != part_rows:
                raise ValueError('typed details did not round-trip every original field')
            for index,row in enumerate(part_rows):
                ordinal=offset+index
                db.execute('INSERT INTO lookup VALUES (?,?,?,?,?,?,?,?)',
                           (ordinal,row['source_id'],row['name'].lower(),row['ra_deg'],row['dec_deg'],
                            part,index//1024,index%1024))
                db.executemany('INSERT INTO aliases VALUES (?,?)',
                               [(alias.lower(),ordinal) for alias in row['aliases']])
                db.execute('INSERT INTO angular VALUES (?,?,?,?,?)',
                           (ordinal,row['ra_deg'],row['ra_deg'],row['dec_deg'],row['dec_deg']))
            db.commit()
            partitions.append({'name':path.name,'rows':len(part_rows),'bytes':path.stat().st_size,
                               'allocated_bytes':path.stat().st_blocks*512,
                               'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest()})
            check(parent)
        before_indexes=footprint(root)
        index_start=time.monotonic()
        db.executescript('''
        CREATE UNIQUE INDEX source_id_index ON lookup(source_id);
        CREATE INDEX name_index ON lookup(name);
        CREATE UNIQUE INDEX alias_index ON aliases(alias,ordinal);
        ANALYZE;
        ''')
        db.commit()
        index_seconds=time.monotonic()-index_start
        page_usage=[{'name':name,'bytes':size} for name,size in
                    db.execute('SELECT name,sum(pgsize) FROM dbstat GROUP BY name ORDER BY name')]
        queries=[]
        for row in (rows[0], rows[len(rows)//2], rows[-1]):
            source_id=row['source_id']
            def detail():
                location=db.execute('SELECT partition,row_group,row_offset FROM lookup WHERE source_id=?',
                                    (source_id,)).fetchone()
                part,group,index=location
                actual=decode(pq.ParquetFile(root/partitions[part]['name']).read_row_group(group).slice(index,1),fields)[0]
                assert actual==row
            alias=row['aliases'][0].lower()
            def by_alias():
                found=db.execute('SELECT ordinal FROM aliases WHERE alias=? LIMIT 101',(alias,)).fetchall()
                assert len(found)==1
            prefix=row['name'].lower()[:15]
            def prefix_search():
                return db.execute('SELECT source_id FROM lookup WHERE name>=? AND name<? ORDER BY name LIMIT 101',
                                  (prefix,prefix+'\uffff')).fetchall()
            ra,dec=row['ra_deg'],row['dec_deg']
            # Bounding box then exact spherical separation. Widen RA near poles;
            # ranges outside [0,360] wrap explicitly. Refuse excessive candidates.
            width=min(180,1/max(.00001,math.cos(math.radians(abs(dec)+1)))) if abs(dec)<89 else 180
            ranges=[(ra-width,ra+width)]
            if ranges[0][0]<0: ranges=[(0,ra+width),(ra-width+360,360)]
            elif ranges[0][1]>360: ranges=[(ra-width,360),(0,ra+width-360)]
            def cone():
                candidates={}
                for lo,hi in ranges:
                    for item in db.execute('''SELECT l.source_id,l.ra,l.dec FROM angular a CROSS JOIN lookup l
                      ON l.ordinal=a.ordinal WHERE min_ra<=? AND max_ra>=? AND min_dec<=? AND max_dec>=? LIMIT 10001''',
                                          (hi,lo,dec+1,dec-1)):
                        candidates[item[0]]=item
                if len(candidates)>=10001: raise OverflowError('cone candidate budget exceeded')
                found=[]
                r,d=math.radians(ra),math.radians(dec)
                for key,x,y in candidates.values():
                    dot=math.sin(d)*math.sin(math.radians(y))+math.cos(d)*math.cos(math.radians(y))*math.cos(r-math.radians(x))
                    if dot>=math.cos(math.radians(1)): found.append(key)
                assert source_id in found
                return sorted(found)[:101]
            queries.append({'source_id':source_id,'detail_including_parquet_decode':timing(detail),
                            'alias':timing(by_alias),'prefix':timing(prefix_search),'cone_1deg':timing(cone)})
        plans={
            'exact':db.execute('EXPLAIN QUERY PLAN SELECT * FROM lookup WHERE source_id=?',(rows[0]['source_id'],)).fetchall(),
            'prefix':db.execute("EXPLAIN QUERY PLAN SELECT source_id FROM lookup WHERE name>=? AND name<? ORDER BY name LIMIT 101",('gaia','gaib')).fetchall(),
            'alias':db.execute('EXPLAIN QUERY PLAN SELECT ordinal FROM aliases WHERE alias=? LIMIT 101',('gaia',)).fetchall(),
            'cone':db.execute('EXPLAIN QUERY PLAN SELECT l.source_id FROM angular a CROSS JOIN lookup l ON l.ordinal=a.ordinal WHERE min_ra<=? AND max_ra>=? AND min_dec<=? AND max_dec>=? LIMIT 10001',(1,0,1,0)).fetchall()}
        db.close()
        final=check(parent)
        for key in high: high[key]=max(high[key],final[key])
        result={'schema_version':1,'scope':'complete selected local Gaia snapshot, NOT complete Gaia DR3',
                'source_sha256':hashlib.file_digest(snapshot.open('rb'),'sha256').hexdigest(),
                'source_file_bytes':snapshot.stat().st_size,'rows':len(rows),'fields':len(fields),
                'original_field_roundtrip':'all records equal after typed Parquet decode',
                'partitions':partitions,'before_indexes':before_indexes,'final_artifacts':footprint(root),
                'sqlite_page_usage':page_usage,'index_build_seconds':index_seconds,
                'elapsed_seconds':time.monotonic()-start,'observed_scratch_high_water':high,
                'high_water_interval_ms':100,'max_process_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                'queries_warm_local_library_only':queries,'query_plans':plans,
                'unknowns':['full source schemas/releases','global crossmatch/identity indexes','general substring/full-text search',
                            'physical and rendering indexes','concurrent/cold/HTTP/browser performance','exact instantaneous build peak',
                            'Postgres integration and WAL/replication/backups']}
        (root/'measurement.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
    finally:
        db.close()
        stop.set()
        watcher.join()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    result=run(args.snapshot,args.output)
    print(json.dumps(result,indent=2))
