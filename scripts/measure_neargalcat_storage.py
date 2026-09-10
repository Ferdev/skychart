#!/usr/bin/env python3
"""Measure all pinned NEARGALCAT TDAT fields with lossless measurement text."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import time
import pyarrow as pa
import pyarrow.parquet as pq
from measure_gaia_full_partitions import save,sha,guard
from measure_fits_exact_lookup import measure as lookup_measure


def rows(document,fields):
    if document.count('<DATA>')!=1 or document.count('<END>')!=1:raise ValueError('missing/ambiguous data boundary')
    header,body=document.split('<DATA>');body,tail=body.split('<END>')
    if tail.strip():raise ValueError('unexpected trailing content')
    declared=re.findall(r'^line\[1\]\s*=\s*(.*)$',header,re.M)
    if len(declared)!=1 or declared[0].split()!=fields:raise ValueError('field order changed')
    result=[]
    for line in body.splitlines():
        if not line:continue
        values=line.split('|')
        if len(values)!=len(fields)+1 or values[-1]!='':raise ValueError('row width changed')
        result.append(dict(zip(fields,[v if v!='' else None for v in values[:-1]])))
    return header,result


def measure(base):
    source=base/'neargalcat-source';audit=json.loads((source/'full.tdat.gz.receipt.json').read_text())
    if audit['status']!='complete_source_validated' or audit['rows']!=869 or audit['columns']!=40:raise ValueError('full source required')
    for name,expected in [('full.tdat.gz',audit['sha256']),('full.tdat',audit['uncompressed_sha256']),('schema.txt',audit['schema_sha256'])]:
        if sha(source/name)!=expected:raise ValueError('source/schema changed')
    header,records=rows((source/'full.tdat').read_text(),audit['fields'])
    if len(records)!=audit['rows']:raise ValueError('row accounting mismatch')
    root=base/'neargalcat-owned-storage';root.mkdir(parents=True,exist_ok=True)
    lock=(root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated NEARGALCAT measurement 1271\n';owner=root/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in root.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'source_audit_sha256':sha(source/'full.tdat.gz.receipt.json'),'format':'tdat-original-field-text-zstd3-v1'}
    if (root/'manifest.json').exists() and json.loads((root/'manifest.json').read_text())!=pin:raise ValueError('contract changed')
    save(root/'manifest.json',pin);detail=root/'detail.parquet';receipt=root/'measurement.json'
    if receipt.exists():
        r=json.loads(receipt.read_text())
        if sha(detail)!=r['sha256']:raise ValueError('completed detail changed')
    else:
        started=time.monotonic();guard(root,100<<30)
        schema=pa.schema([(f,pa.string()) for f in audit['fields']],metadata={
            b'source_header':header.encode(),b'source_sha256':audit['uncompressed_sha256'].encode(),
            b'semantics':b'All 40 original text values and metadata preserved; empty cells become null; no measurement inference'})
        part=detail.with_suffix('.partial');table=pa.Table.from_pylist(records,schema=schema)
        pq.write_table(table,part,compression='zstd',compression_level=3,use_dictionary=False,row_group_size=256)
        restored=pq.read_table(part)
        if not restored.schema.equals(schema,check_metadata=True) or restored.to_pylist()!=records:raise ValueError('field roundtrip failed')
        with part.open('rb') as f:os.fsync(f.fileno())
        part.replace(detail)
        r={'status':'FULL_TDAT_TABLE_DATA_COMPONENT_MEASURED','rows':len(records),'columns':40,
            'all_fields_verified':True,'bytes':detail.stat().st_size,'allocated_bytes':detail.stat().st_blocks*512,
            'sha256':sha(detail),'seconds':time.monotonic()-started,'full_serving_bytes':None}
        save(receipt,r)
    return {'data':r,'lookup':lookup_measure(root,base/'neargalcat-exact-lookup',['name','neighbor_galaxy_name'])}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();print(json.dumps(measure(a.root)))
