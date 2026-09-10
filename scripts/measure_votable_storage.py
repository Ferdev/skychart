#!/usr/bin/env python3
"""Measure complete audited scalar TABLEDATA values with their original field metadata."""
import argparse
import fcntl
import itertools
import json
import os
from pathlib import Path
import time
import pyarrow as pa
import pyarrow.parquet as pq
from measure_quaia_owned_storage import records,equal,TYPES
from measure_gaia_full_partitions import guard,save,sha


def measure(source,audit_path,output):
    audit=json.loads(audit_path.read_text())
    if audit['status']!='complete_TABLEDATA_source_audited' or sha(source)!=audit['sha256']:raise ValueError('unchanged audited source required')
    fields=[(f['attributes']['name'],f['attributes']['datatype']) for f in audit['fields']]
    if len(fields)!=audit['columns'] or len(set(n for n,t in fields))!=len(fields):raise ValueError('field accounting mismatch')
    for f in audit['fields']:
        attrs=f['attributes'];kind=attrs['datatype']
        if kind not in TYPES or (kind!='char' and attrs.get('arraysize','1')!='1'):
            raise ValueError('unsupported datatype or numeric array')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated scalar VOTable data measurement 1271\n';owner=output/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'source_audit_sha256':sha(audit_path),'format':'scalar-votable-native-types-zstd3-rg256-v1'}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('contract changed')
    save(output/'manifest.json',pin);path=output/'detail.parquet';receipt=output/'measurement.json'
    if receipt.exists():
        result=json.loads(receipt.read_text())
        if sha(path)!=result['sha256']:raise ValueError('completed detail changed')
        return result
    started=time.monotonic();count=0;stream=records(source,fields)
    schema=pa.schema([(name,TYPES[kind]) for name,kind in fields],metadata={
        b'source_fields':json.dumps(audit['fields']).encode(),b'source_sha256':audit['sha256'].encode(),
        b'semantics':b'Original scalar values, units, errors and flags retained; no coordinate/distance inference'})
    part=path.with_suffix('.partial')
    with pq.ParquetWriter(part,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
        while batch:=list(itertools.islice(stream,256)):
            guard(output,100<<30);writer.write_table(pa.Table.from_pylist(batch,schema=schema),row_group_size=256);count+=len(batch)
            save(output/'progress.json',{'status':'CONVERTING_ALL_FIELDS','rows':count,'expected_rows':audit['rows']})
    if count!=audit['rows']:raise ValueError('source row count mismatch')
    stored=pq.ParquetFile(part);stream=records(source,fields);verified=0
    if not stored.schema_arrow.equals(schema,check_metadata=True):raise ValueError('metadata changed')
    for group in range(stored.num_row_groups):
        for row in stored.read_row_group(group,use_threads=False).to_pylist():
            if not equal(row,next(stream)):raise ValueError('scientific value changed')
            verified+=1
        save(output/'progress.json',{'status':'VERIFYING_ALL_FIELDS','rows':verified,'expected_rows':count})
    if next(stream,None) is not None or verified!=count:raise ValueError('verification count mismatch')
    with part.open('rb') as f:os.fsync(f.fileno())
    part.replace(path)
    result={'status':'FULL_SCALAR_VOTABLE_DATA_COMPONENT_MEASURED','rows':count,'columns':len(fields),
        'all_fields_verified':True,'bytes':path.stat().st_size,'allocated_bytes':path.stat().st_blocks*512,
        'sha256':sha(path),'seconds':time.monotonic()-started,'full_serving_bytes':None,
        'remaining':['identifier and angular routing','relationships and identities','native rendering and API budgets']}
    save(receipt,result);save(output/'progress.json',{'status':result['status']});return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['source','audit','output']:p.add_argument(name,type=Path)
    a=p.parse_args();print(json.dumps(measure(a.source,a.audit,a.output)))
