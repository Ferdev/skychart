#!/usr/bin/env python3
"""Measure lossless ATNF source-record blocks and exact PSRJ/PSRB lookup.

This candidate keeps every byte of source scientific records, including comments
and uncertainties. It does not claim typed physical normalization or native APIs.
"""
import argparse
from collections import Counter
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import time
import pyarrow as pa
import pyarrow.parquet as pq
from measure_gaia_full_partitions import save,sha,guard


def split_records(raw):
    header=[];records=[];block=[];started=False
    for line in raw.splitlines(keepends=True):
        if line.startswith(b'PSRJ '):started=True
        if not started:header.append(line);continue
        block.append(line)
        if line.startswith(b'@'):
            payload=b''.join(block);block=[];ids={};tags=Counter()
            for entry in payload.splitlines():
                if not entry or entry.startswith((b'#',b'@')):continue
                parts=entry.split();tag=parts[0].decode('ascii');tags[tag]+=1
                if tag in ['PSRJ','PSRB']:
                    if tag in ids or len(parts)<2:raise ValueError('missing or repeated record identifier')
                    ids[tag]=parts[1].decode('ascii')
            if 'PSRJ' not in ids:raise ValueError('record lacks PSRJ')
            records.append((ids['PSRJ'],ids.get('PSRB'),payload,tags))
    if block:raise ValueError('unterminated record')
    if len({r[0] for r in records})!=len(records):raise ValueError('duplicate PSRJ')
    return b''.join(header),records


def measure(base):
    package=base/'small-releases/psrcat_pkg.v2.8.1.tar.gz';audit=json.loads((base/'small-releases/psrcat-content.json').read_text())
    root=base/'atnf-owned-storage';root.mkdir(parents=True,exist_ok=True)
    lock=(root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated ATNF 2.8.1 record measurement 1271\n';owner=root/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in root.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    with tarfile.open(package) as archive:
        matches=[m for m in archive.getmembers() if m.name=='psrcat_tar/psrcat.db']
        if len(matches)!=1 or not matches[0].isfile():raise ValueError('ambiguous database member')
        raw=archive.extractfile(matches[0]).read()
    if len(raw)!=audit['database_bytes'] or hashlib.sha256(raw).hexdigest()!=audit['database_sha256']:raise ValueError('database audit mismatch')
    header,records=split_records(raw)
    if len(records)!=audit['psrj_identifiers'] or len(records)!=4393:raise ValueError('record accounting mismatch')
    pin={'package_sha256':sha(package),'database_sha256':audit['database_sha256'],'format':'atnf-lossless-record-blocks-zstd3-v1'}
    if (root/'manifest.json').exists() and json.loads((root/'manifest.json').read_text())!=pin:raise ValueError('release changed')
    save(root/'manifest.json',pin);path=root/'records.parquet';index=root/'lookup.sqlite';receipt=root/'measurement.json'
    if receipt.exists():
        r=json.loads(receipt.read_text())
        if sha(path)!=r['detail_sha256'] or sha(index)!=r['index_sha256']:raise ValueError('completed artifact changed')
        return r
    started=time.monotonic();guard(root,100<<30);tags=Counter()
    schema=pa.schema([('PSRJ',pa.string()),('PSRB',pa.string()),('source_record',pa.binary())],metadata={
        b'source_header':header,b'database_sha256':audit['database_sha256'].encode(),
        b'semantics':b'Lossless source record bytes including separators, comments, uncertainty digits, provenance and flags; no physical inference'})
    partial=path.with_suffix('.partial')
    with pq.ParquetWriter(partial,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        for start in range(0,len(records),256):
            writer.write_table(pa.Table.from_pylist([{'PSRJ':j,'PSRB':b,'source_record':record} for j,b,record,t in records[start:start+256]],schema=schema),row_group_size=256)
    stored=pq.ParquetFile(partial);digest=hashlib.sha256(header);offset=0
    if not stored.schema_arrow.equals(schema,check_metadata=True):raise ValueError('metadata changed')
    for batch in stored.iter_batches(batch_size=256,use_threads=False):
        for row in batch.to_pylist():
            j,b,payload,t=records[offset]
            if row!={'PSRJ':j,'PSRB':b,'source_record':payload}:raise ValueError('record changed')
            digest.update(row['source_record']);tags.update(t);offset+=1
    if offset!=len(records) or digest.hexdigest()!=audit['database_sha256']:raise ValueError('database reconstruction failed')
    with partial.open('rb') as f:os.fsync(f.fileno())
    partial.replace(path)
    with sqlite3.connect(index) as db:
        db.executescript('CREATE TABLE IF NOT EXISTS records(PSRJ TEXT PRIMARY KEY,PSRB TEXT,rg INTEGER,off INTEGER); CREATE INDEX IF NOT EXISTS aliases ON records(PSRB);')
        with db:
            for i,(j,b,payload,t) in enumerate(records):db.execute('INSERT OR IGNORE INTO records VALUES (?,?,?,?)',(j,b,i//256,i%256))
        if db.execute('SELECT count(*) FROM records').fetchone()[0]!=len(records):raise ValueError('lookup row mismatch')
        for i,(j,b,payload,t) in enumerate(records):
            if db.execute('SELECT PSRB,rg,off FROM records WHERE PSRJ=?',(j,)).fetchone()!=(b,i//256,i%256):raise ValueError('locator mismatch')
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise ValueError('lookup integrity failed')
    result={'status':'FULL_ATNF_LOSSLESS_RECORD_AND_ID_COMPONENTS_MEASURED','rows':len(records),
        'detail_bytes':path.stat().st_size,'detail_allocated_bytes':path.stat().st_blocks*512,'detail_sha256':sha(path),
        'index_bytes':index.stat().st_size,'index_allocated_bytes':index.stat().st_blocks*512,'index_sha256':sha(index),
        'source_database_reconstructed_sha256':digest.hexdigest(),'all_records_and_locators_verified':True,
        'source_field_occurrences':dict(tags),'seconds':time.monotonic()-started,'full_serving_bytes':None,
        'remaining':['typed scientific hydration and uncertainty interpretation','angular rendering','identity associations','native APIs and budgets']}
    save(receipt,result);return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();print(json.dumps(measure(a.root)))
