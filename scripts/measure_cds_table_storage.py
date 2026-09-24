#!/usr/bin/env python3
"""Measure complete audited plain CDS fixed-width tables without precision loss.

Original field text and metadata are retained; blank fields become null. The
original source retains delimiters and padding. No physical position is inferred.
"""
import argparse
import fcntl
import itertools
import json
import os
from pathlib import Path
import time
import pyarrow as pa
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard,save,sha


def records(source,audit):
    fields=audit['schema'];last=max(f['end'] for f in fields)
    with source.open('rb') as stream:
        for line in stream:
            raw=line.rstrip(b'\r\n')
            if audit.get('pad_short_records') and raw and len(raw)<audit['record_width']:
                raw=raw.ljust(audit['record_width'],b' ')
            if len(raw)!=audit['record_width'] or raw[last:].strip(b' '):raise ValueError('record layout changed')
            yield {f['name']:(raw[f['start']-1:f['end']].strip().decode('ascii') or None) for f in fields}


def measure(source,readme,audit_path,output):
    audit=json.loads(audit_path.read_text())
    if audit['status']!='SOURCE_FIELDS_AUDITED':raise ValueError('complete field audit required')
    if sha(source)!=audit['source_sha256'] or sha(readme)!=audit['readme_sha256']:raise ValueError('source or schema changed')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=output/'OWNER';marker='SkyChart isolated CDS full table storage 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'audit_sha256':sha(audit_path),'format':'cds-full-field-text-zstd3-rg4096-v1'}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('storage contract changed')
    save(output/'manifest.json',pin);path=output/'detail.parquet';receipt=output/'measurement.json'
    if receipt.exists():
        result=json.loads(receipt.read_text())
        if sha(path)!=result['sha256']:raise ValueError('completed detail changed')
        return result
    started=time.monotonic();fields=audit['schema'];count=0
    schema=pa.schema([(f['name'],pa.string()) for f in fields],metadata={
        b'source_readme':readme.read_bytes(),b'source_schema':json.dumps(fields).encode(),
        b'source_sha256':audit['source_sha256'].encode(),
        b'normalization':b'All original field precision and flags retained as text; trimmed blanks become null; no coordinate/distance inference'})
    part=path.with_suffix('.partial');stream=records(source,audit)
    with pq.ParquetWriter(part,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        while batch:=list(itertools.islice(stream,4096)):
            guard(output,100<<30)
            writer.write_table(pa.Table.from_pylist(batch,schema=schema),row_group_size=4096);count+=len(batch)
            save(output/'progress.json',{'status':'CONVERTING_ALL_FIELDS','rows':count,'expected_rows':audit['rows']})
    if count!=audit['rows']:raise ValueError('source count changed')
    stored=pq.ParquetFile(part);stream=records(source,audit);verified=0
    if not stored.schema_arrow.equals(schema,check_metadata=True):raise ValueError('schema metadata changed')
    for group in range(stored.num_row_groups):
        for row in stored.read_row_group(group,use_threads=False).to_pylist():
            if row!=next(stream):raise ValueError('scientific field changed')
            verified+=1
        save(output/'progress.json',{'status':'VERIFYING_ALL_FIELDS','rows':verified,'expected_rows':count})
    if next(stream,None) is not None or verified!=count:raise ValueError('verification count mismatch')
    with part.open('rb') as f:os.fsync(f.fileno())
    part.replace(path)
    result={'status':'FULL_CDS_TABLE_DATA_COMPONENT_MEASURED','rows':count,'columns':len(fields),
        'bytes':path.stat().st_size,'allocated_bytes':path.stat().st_blocks*512,'sha256':sha(path),
        'all_fields_verified':True,'seconds':time.monotonic()-started,'full_serving_bytes':None,
        'remaining':['identifier/alias and angular routing','cross-identification evidence','native rendering and API budgets']}
    save(receipt,result);save(output/'progress.json',{'status':result['status']});return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['source','readme','audit','output']:p.add_argument(name,type=Path)
    a=p.parse_args();print(json.dumps(measure(a.source,a.readme,a.audit,a.output)))
