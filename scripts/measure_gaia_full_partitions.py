#!/usr/bin/env python3
"""Resumable all-field Gaia DR3 measurement; receipts are NOT full serving totals.

Sequentially creates, verifies and measures complete source-file partitions.
Only this tool's owned temporary output is recycled. Source files supplied by
callers remain untouched. Durable receipts survive recycling and interruption.
"""
import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import time
import urllib.request

import pyarrow as pa
import pyarrow.csv as csv
import pyarrow.parquet as pq
import yaml

BASE='https://cdn.gea.esac.esa.int/Gaia/gdr3/gaia_source/'
FORMAT='gaia-dr3-all-fields-zstd3-rg4096-v1'
BUILD_COLUMNS=('source_id','ra','dec','ref_epoch','parallax','parallax_error',
               'parallax_over_error','pmra','pmdec','radial_velocity',
               'phot_g_mean_mag','bp_rp','ruwe','astrometric_params_solved',
               'duplicated_source')

def build_projection(source,output,expected_rows,root,floor):
    """Retained workspace for later global builds; not full scientific detail."""
    start=time.monotonic()
    skip,schema=header(source)
    original=yaml.safe_load(schema.metadata[b'original_ecsv_header'].decode().split('\n',1)[1])
    original_types={field['name']:field['datatype'] for field in original['datatype']}
    projected=pa.schema([(name,pa.float32() if original_types[name]=='float32' else schema.field(name).type)
                         for name in BUILD_COLUMNS],metadata={
        b'purpose':b'global index and native tile build workspace; not full source detail',
        b'precision':b'original ECSV-declared types; full detail preserves decimal-to-f64 values separately',
        b'format':b'gaia-build-projection-v2'})
    def batches():
        return csv.open_csv(source,read_options=csv.ReadOptions(skip_rows=skip,use_threads=False,block_size=1<<20),
            convert_options=csv.ConvertOptions(column_types={f.name:f.type for f in projected},
            include_columns=list(BUILD_COLUMNS),null_values=['','null'],strings_can_be_null=True,
            true_values=['true','True'],false_values=['false','False']))
    temporary=output.with_suffix('.parquet.tmp')
    rows=0
    with pq.ParquetWriter(temporary,projected,compression='zstd',compression_level=3,
                         use_dictionary=False,column_encoding={'source_id':'DELTA_BINARY_PACKED'}) as writer:
        for batch in batches():
            table=pa.Table.from_batches([batch]).replace_schema_metadata(projected.metadata)
            writer.write_table(table,row_group_size=4096);rows+=len(table);guard(root,floor)
    if rows!=expected_rows:raise ValueError('build projection row mismatch')
    file=pq.ParquetFile(temporary);group=0;verified=0
    for batch in batches():
        table=pa.Table.from_batches([batch]).replace_schema_metadata(projected.metadata)
        for offset in range(0,len(table),4096):
            expected=table.slice(offset,4096);actual=file.read_row_group(group)
            if not expected.equals(actual):raise ValueError('build projection lost scientific fields')
            verified+=len(actual);group+=1
        guard(root,floor)
    if verified!=rows:raise ValueError('projection verification row mismatch')
    temporary.replace(output)
    return {'format':'gaia-build-projection-v2','path':str(output.relative_to(root)),'rows':rows,'bytes':output.stat().st_size,
            'allocated_bytes':output.stat().st_blocks*512,'sha256':sha(output),
            'seconds':time.monotonic()-start,'columns':list(BUILD_COLUMNS),
            'scope':'retained build workspace only; global artifacts still unbuilt'}

def sha(path,algorithm='sha256'):
    with path.open('rb') as f:return hashlib.file_digest(f,algorithm).hexdigest()

def save(path,value):
    temp=path.with_suffix(path.suffix+'.tmp')
    with temp.open('w') as f:
        json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    temp.replace(path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

def guard(root,floor):
    free=shutil.disk_usage(root).free
    if free<floor:raise RuntimeError(f'free-space headroom reached: {free} < {floor}')
    return free

def header(path):
    comments=[]
    with gzip.open(path,'rt') as f:
        for line in f:
            if not line.startswith('#'):break
            comments.append(line[2:])
    metadata=yaml.safe_load(''.join(comments[1:]))
    fields=metadata['datatype']
    if len(fields)!=152:raise ValueError('Gaia release schema drift: expected 152 columns')
    types={'int64':pa.int64(),'int32':pa.int32(),'int16':pa.int16(),'int8':pa.int8(),
           'float64':pa.float64(),'float32':pa.float64(),'bool':pa.bool_(),'string':pa.string()}
    # Retain source decimal precision in double; original ECSV metadata stays pinned.
    schema=pa.schema([(f['name'],types[f['datatype']]) for f in fields],metadata={
        b'format':FORMAT.encode(),b'original_ecsv_header':''.join(comments).encode()})
    return len(comments),schema

def measure(source,out,expected_md5,root,floor):
    start=time.monotonic();guard(root,floor)
    if sha(source,'md5')!=expected_md5:raise ValueError('source MD5 mismatch')
    skip,schema=header(source)
    schema_path=root/'source-schema.json'
    signature=[(f.name,str(f.type)) for f in schema]
    if schema_path.exists():
        if json.loads(schema_path.read_text())['fields']!=[list(x) for x in signature]:raise ValueError('cross-partition schema drift')
    else:save(schema_path,{'format':FORMAT,'fields':signature,'ecsv_header':schema.metadata[b'original_ecsv_header'].decode()})
    reader=csv.open_csv(source,read_options=csv.ReadOptions(skip_rows=skip,use_threads=False,block_size=1<<20),
        convert_options=csv.ConvertOptions(column_types={f.name:f.type for f in schema},null_values=['','null'],
        strings_can_be_null=True,true_values=['true','True'],false_values=['false','False']))
    rows=0;groups=[];minimum=None;maximum=None
    with pq.ParquetWriter(out,schema,compression='zstd',compression_level=3) as writer:
        for batch in reader:
            table=pa.Table.from_batches([batch],schema=schema)
            for offset in range(0,len(table),4096):
                part=table.slice(offset,4096)
                ids=part['source_id'].to_pylist()
                if any(b<=a for a,b in zip(ids,ids[1:])) or (maximum is not None and ids[0]<=maximum):
                    raise ValueError('source-ID ordering violated; range routing cannot be assumed')
                minimum=ids[0] if minimum is None else minimum;maximum=ids[-1]
                writer.write_table(part,row_group_size=4096)
                groups.append({'rows':len(part),'min_id':str(ids[0]),'max_id':str(ids[-1])})
                rows+=len(part)
            guard(root,floor)
    # Rescan independently and compare every field of every parsed record.
    verify=csv.open_csv(source,read_options=csv.ReadOptions(skip_rows=skip,use_threads=False,block_size=1<<20),
        convert_options=csv.ConvertOptions(column_types={f.name:f.type for f in schema},null_values=['','null'],
        strings_can_be_null=True,true_values=['true','True'],false_values=['false','False']))
    file=pq.ParquetFile(out);g=0;checked=0
    for batch in verify:
        table=pa.Table.from_batches([batch],schema=schema)
        for offset in range(0,len(table),4096):
            expected=table.slice(offset,4096);actual=file.read_row_group(g)
            if not expected.equals(actual):raise ValueError(f'lossless verification failed at group {g}')
            checked+=len(actual);g+=1
        guard(root,floor)
    if checked!=rows or file.metadata.num_rows!=rows:raise ValueError('row reconciliation failed')
    st=out.stat()
    return {'format':FORMAT,'source_file':source.name,'source_bytes':source.stat().st_size,
            'source_md5':expected_md5,'source_sha256':sha(source),'rows':rows,'columns':152,
            'parquet_bytes':st.st_size,'parquet_allocated_bytes':st.st_blocks*512,'parquet_sha256':sha(out),
            'row_groups':groups,'min_source_id':str(minimum),'max_source_id':str(maximum),
            'all_field_roundtrip_verified':True,'seconds':time.monotonic()-start,
            'max_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'global_indexes_crossmatches_rendering':'NOT MEASURED; excluded from this component receipt'}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--existing-source',type=Path);p.add_argument('--max-files',type=int,default=0)
    p.add_argument('--free-floor-gib',type=int,default=100)
    a=p.parse_args();a.root.mkdir(parents=True,exist_ok=True)
    lock=(a.root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker=a.root/'OWNER'
    if not marker.exists():
        if any(x.name!='.lock' for x in a.root.iterdir()):raise ValueError('refuse unowned nonempty directory')
        marker.write_text('SkyChart exhaustive investigation 1271\n')
    elif marker.read_text()!='SkyChart exhaustive investigation 1271\n':raise ValueError('ownership mismatch')
    pinned=a.root/'manifest.txt'
    if pinned.exists() and sha(pinned)!=sha(a.manifest):raise ValueError('manifest changed; new release directory required')
    if not pinned.exists():shutil.copyfile(a.manifest,pinned)
    import re
    entries=re.findall(r'^([a-f0-9]{32})\s+(GaiaSource_[\d-]+\.csv\.gz)$',pinned.read_text(),re.M)
    if len(entries)!=3386:raise ValueError('full manifest must have 3386 files')
    receipts=a.root/'receipts';receipts.mkdir(exist_ok=True);count=0
    projections=a.root/'build-projections';projections.mkdir(exist_ok=True)
    for md5,name in entries:
        receipt=receipts/(name+'.json')
        previous=None
        if receipt.exists():
            previous=json.loads(receipt.read_text())
            if previous['source_md5']!=md5 or previous['format']!=FORMAT or not previous['all_field_roundtrip_verified']:
                raise ValueError('invalid existing receipt')
            if previous.get('build_projection'):
                if previous['build_projection'].get('format')!='gaia-build-projection-v2':
                    raise ValueError('build projection format changed; explicit migration required')
                projection=a.root/previous['build_projection']['path']
                if not projection.exists() or projection.stat().st_size!=previous['build_projection']['bytes']:
                    raise ValueError('retained build projection missing or changed')
                continue
        if a.max_files and count>=a.max_files:break
        guard(a.root,a.free_floor_gib*(1<<30))
        source=a.root/'download.gz';owned=True
        if a.existing_source and a.existing_source.name==name:source=a.existing_source;owned=False
        else:
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(BASE+name,timeout=120) as r,source.open('wb') as f:
                        while chunk:=r.read(1<<20):
                            guard(a.root,a.free_floor_gib*(1<<30));f.write(chunk)
                    if sha(source,'md5')!=md5:raise ValueError('download checksum mismatch')
                    break
                except (OSError,ValueError):
                    if attempt==3:raise
                    time.sleep(5*(attempt+1))
        output=a.root/'partition.parquet'
        if previous:
            if sha(source,'md5')!=md5:raise ValueError('backfill source checksum mismatch')
            result=previous
        else:
            result=measure(source,output,md5,a.root,a.free_floor_gib*(1<<30));result['source_file']=name
        result['build_projection']=build_projection(source,projections/(name+'.parquet'),result['rows'],a.root,a.free_floor_gib*(1<<30))
        save(receipt,result)
        # Only fixed tool-owned files; the durable receipt is committed first.
        if not previous:output.unlink()
        if owned:source.unlink()
        count+=1
        save(a.root/'progress.json',{'status':'INCOMPLETE','completed_files':len(list(receipts.glob('*.json'))),
            'manifest_files':len(entries),'last_file':name,'last_rows':result['rows'],'last_seconds':result['seconds']})
        print(json.dumps({'file':name,'phase':'projection_backfill' if previous else 'detail_and_projection',
                          'rows':result['rows'],'detail_seconds':result['seconds'],
                          'projection_seconds':result['build_projection']['seconds'],
                          'parquet_bytes':result['parquet_bytes']}),flush=True)

if __name__=='__main__':main()
