#!/usr/bin/env python3
"""Measure complete source-attributed OpenNGC name evidence and angular index.

No cross-reference establishes a unique physical identity. Central-star names
are relationships, not aliases for their parent nebula. No distance is inferred.
"""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import pyarrow.parquet as pq
from measure_gaia_full_partitions import sha,save,guard


def angle(value,ra=False):
    if not value:return None
    parts=value.split(':')
    if len(parts)!=3:raise ValueError('invalid source sexagesimal angle')
    first,minutes,seconds=map(float,parts)
    limit=24 if ra else 90
    if not all(math.isfinite(v) for v in (first,minutes,seconds)) or not 0<=minutes<60 or not 0<=seconds<60:
        raise ValueError('invalid source sexagesimal component')
    if abs(first)>limit or (abs(first)==limit and (minutes or seconds)) or (ra and first<0):
        raise ValueError('source angle out of range')
    sign=-1 if value.startswith('-') else 1
    result=sign*(abs(first)+minutes/60+seconds/3600)
    return result*15%360 if ra else result


def references(row):
    for field,prefix in [('M','M'),('NGC','NGC'),('IC','IC'),('Identifiers',''),('Common names',''),('Cstar Names','')]:
        for raw in row[field].split(','):
            token=raw.strip()
            if not token:continue
            # Preserve catalog numbering and suffixes verbatim in evidence;
            # query normalization belongs to the separately measured API layer.
            yield prefix+token,field,'central_star' if field=='Cstar Names' else 'published_name_evidence'


def measure(source_root,output):
    receipt=json.loads((source_root/'measurement.json').read_text())
    source=source_root/'detail.parquet'
    if sha(source)!=receipt['files']['detail.parquet']['sha256']:raise ValueError('source detail changed')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=output/'OWNER';marker='SkyChart isolated OpenNGC evidence index 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'detail_sha256':sha(source),'source_epoch':'J2000 as documented by pinned OpenNGC guide',
         'position_kind':'angular only; no physical placement','format':'openngc-published-evidence-angular-v1'}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('input changed')
    save(output/'manifest.json',pin)
    if (output/'measurement.json').exists():
        r=json.loads((output/'measurement.json').read_text())
        if sha(output/'evidence.sqlite')!=r['sha256']:raise ValueError('completed index changed')
        return r
    guard(output,100<<30);start=time.monotonic();part=output/'evidence.partial';part.unlink(missing_ok=True)
    table=pq.ParquetFile(source);count=angular=names=relationships=0
    with sqlite3.connect(part) as db:
        db.execute('CREATE TABLE records (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, ra REAL, dec REAL)')
        db.execute('CREATE TABLE evidence (label TEXT, record_id INTEGER, source_field TEXT, kind TEXT, PRIMARY KEY(label,record_id,source_field,kind)) WITHOUT ROWID')
        db.execute('CREATE VIRTUAL TABLE angular USING rtree(id,ra_min,ra_max,dec_min,dec_max)')
        for group in range(table.num_row_groups):
            for row in table.read_row_group(group,use_threads=False).to_pylist():
                count+=1;ra=angle(row['RA'],True);dec=angle(row['Dec'])
                db.execute('INSERT INTO records VALUES (?,?,?,?)',(count,row['Name'],ra,dec))
                if ra is not None and dec is not None:
                    db.execute('INSERT INTO angular VALUES (?,?,?,?,?)',(count,ra,ra,dec,dec));angular+=1
                for label,field,kind in references(row):
                    inserted=db.execute('INSERT OR IGNORE INTO evidence VALUES (?,?,?,?)',(label,count,field,kind)).rowcount
                    if kind=='central_star':relationships+=inserted
                    else:names+=inserted
        db.commit()
        if count!=receipt['rows']:raise ValueError('full record count mismatch')
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)] or db.execute("SELECT rtreecheck('angular')").fetchone()!=('ok',):raise ValueError('index integrity failed')
        # Independently verify every stored angular bound encloses the exact
        # source position. RTree float32 bounds are not replacement astrometry.
        enclosed=db.execute('SELECT count(*) FROM records r JOIN angular a ON r.id=a.id WHERE a.ra_min<=r.ra AND a.ra_max>=r.ra AND a.dec_min<=r.dec AND a.dec_max>=r.dec').fetchone()[0]
        if enclosed!=angular:raise ValueError('angular bounds omit source positions')
        verified=0
        for group in range(table.num_row_groups):
            for row in table.read_row_group(group,use_threads=False).to_pylist():
                record_id=db.execute('SELECT id FROM records WHERE name=?',(row['Name'],)).fetchone()[0]
                for label,field,kind in references(row):
                    if not db.execute('SELECT 1 FROM evidence WHERE label=? AND record_id=? AND source_field=? AND kind=?',(label,record_id,field,kind)).fetchone():raise ValueError('missing published evidence')
                    verified+=1
    with part.open('rb') as f:os.fsync(f.fileno())
    path=output/'evidence.sqlite';part.replace(path)
    result={'status':'FULL_NAME_EVIDENCE_AND_ANGULAR_COMPONENT_MEASURED','rows':count,'angular_rows':angular,
            'missing_angular_rows':count-angular,'published_name_entries':names,'central_star_relationship_entries':relationships,
            'source_evidence_occurrences_verified':verified,'angular_bounds_verified':enclosed,
            'bytes':path.stat().st_size,'allocated_bytes':path.stat().st_blocks*512,'sha256':sha(path),
            'seconds':time.monotonic()-start,'full_serving_bytes':None,
            'remaining':['native query normalization and API integration','cross-catalog identity assembly','angular rendering artifacts','full native performance budgets']}
    save(output/'measurement.json',result);return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_root',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    print(json.dumps(measure(a.source_root,a.output)))
