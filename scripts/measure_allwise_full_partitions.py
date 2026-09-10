#!/usr/bin/env python3
"""Sequential all-field AllWISE measurement, with durable per-file receipts.

Recompression is a measured candidate layout, not a complete serving design.
Only owned temporary source/detail files are recycled after verified receipts.
"""
import argparse
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request
import pyarrow as pa
import pyarrow.parquet as pq

from measure_gaia_full_partitions import guard, save, sha
from recompress_catalog_partitions import equal_values

BASE='https://irsa.ipac.caltech.edu/data/download/parquet/wise/allwise/healpix_k5/'
FORMAT='allwise-all298-zstd3-rg4096-v1'
COLUMNS=['cntr','designation','ra','dec','w1mpro','w2mpro','w3mpro','w4mpro','ph_qual','cc_flags','ext_flg','n_2mass','tmass_key']


def measure(source, detail, projection, expected_rows):
    original=pq.ParquetFile(source);schema=original.schema_arrow
    if len(schema)!=298 or original.metadata.num_rows!=expected_rows:
        raise ValueError('full source schema/count drift')
    subset=pa.schema([schema.field(n) for n in COLUMNS],metadata={b'purpose':b'global build input, not full detail or serving artifact'})
    rows=0
    with pq.ParquetWriter(detail,schema,compression='zstd',compression_level=3,write_statistics=True) as writer, pq.ParquetWriter(projection,subset,compression='zstd',compression_level=3,use_dictionary=False) as projected:
        for batch in original.iter_batches(batch_size=4096,use_threads=False):
            writer.write_batch(batch,row_group_size=4096)
            projected.write_table(pa.Table.from_batches([batch]).select(COLUMNS).replace_schema_metadata(subset.metadata),row_group_size=4096)
            rows+=batch.num_rows
    converted=pq.ParquetFile(detail);projected=pq.ParquetFile(projection);verified=0
    for left,right,small in zip(original.iter_batches(batch_size=4096,use_threads=False),converted.iter_batches(batch_size=4096,use_threads=False),projected.iter_batches(batch_size=4096,use_threads=False),strict=True):
        if not equal_values(left,right):raise ValueError('schema/value/null mismatch')
        expected=pa.Table.from_batches([left]).select(COLUMNS).replace_schema_metadata(subset.metadata)
        if not equal_values(expected,pa.Table.from_batches([small])):raise ValueError('build projection loss')
        verified+=left.num_rows
    if rows!=verified or rows!=expected_rows:raise ValueError('decoded accounting mismatch')
    return schema


def main(root, rows_manifest, md5_manifest, max_files=0):
    root.mkdir(parents=True,exist_ok=True)
    lock=(root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=root/'OWNER';marker='SkyChart isolated full AllWISE measurement 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned directory')
    else:
        if any(p.name!='.lock' for p in root.iterdir()):raise ValueError('nonempty unowned directory')
        owner.write_text(marker)
    pin={'format':FORMAT,'rows_sha256':sha(rows_manifest),'md5_manifest_sha256':sha(md5_manifest)}
    if (root/'manifest.json').exists() and json.loads((root/'manifest.json').read_text())!=pin:raise ValueError('release changed')
    save(root/'manifest.json',pin)
    rows=list(csv.DictReader(rows_manifest.open()))
    md5s={line.split()[1]:line.split()[0] for line in md5_manifest.read_text().splitlines() if line.strip()}
    if len(rows)!=12288 or len({r['path'] for r in rows})!=12288 or sum(int(r['nrows']) for r in rows)!=747634026:raise ValueError('full release manifest mismatch')
    for folder in ['receipts','build-projections']:(root/folder).mkdir(exist_ok=True)
    added=0
    for index,r in enumerate(rows):
        if max_files and added>=max_files:break
        name=f'{index:05d}';receipt=root/'receipts'/(name+'.json')
        if receipt.exists():
            prior=json.loads(receipt.read_text())
            if prior['format']!=FORMAT or prior['path']!=r['path'] or prior['rows']!=int(r['nrows']) or prior['provider_md5']!=md5s[r['path']] or not prior['all_fields_verified']:
                raise ValueError('checkpoint source contract changed')
            projection=root/'build-projections'/(name+'.parquet')
            if sha(projection)!=prior['build_projection']['sha256']:raise ValueError('checkpoint projection changed')
            continue
        if '..' in Path(r['path']).parts or r['path'].startswith('/') or r['path'] not in md5s:raise ValueError('unsafe/unpinned source path')
        guard(root,100*(1<<30));started=time.time();source=root/'source.tmp.parquet';detail=root/'detail.tmp.parquet'
        projection=root/'build-projections'/(name+'.parquet')
        save(root/'progress.json',{'status':'ACQUIRING','index':index,'path':r['path'],'started_unix':started})
        h=hashlib.md5()
        with urllib.request.urlopen(BASE+r['path'],timeout=120) as response,source.open('wb') as f:
            while block:=response.read(1<<20):
                guard(root,100*(1<<30));f.write(block);h.update(block)
            f.flush();os.fsync(f.fileno())
        if h.hexdigest()!=md5s[r['path']]:raise ValueError('provider MD5 mismatch')
        save(root/'progress.json',{'status':'MEASURING','index':index,'path':r['path']})
        schema=measure(source,detail,projection,int(r['nrows']))
        schema_bytes=schema.remove_metadata().serialize().to_pybytes();schema_path=root/'schema.arrow'
        if schema_path.exists():
            if schema_path.read_bytes()!=schema_bytes:raise ValueError('source field schema drift')
        else:schema_path.write_bytes(schema_bytes)
        result={'format':FORMAT,'path':r['path'],'rows':int(r['nrows']),'columns':len(schema),
                'provider_md5':h.hexdigest(),'source_sha256':sha(source),'source_bytes':source.stat().st_size,
                'detail_bytes':detail.stat().st_size,'detail_allocated_bytes':detail.stat().st_blocks*512,'detail_sha256':sha(detail),
                'build_projection':{'file':projection.name,'bytes':projection.stat().st_size,'sha256':sha(projection)},
                'all_fields_verified':True,'seconds':time.time()-started,'full_serving_bytes':None}
        for path in [detail,projection]:
            with path.open('rb') as f:os.fsync(f.fileno())
        save(receipt,result)
        # Source/detail are only the two temporary files owned by this worker.
        source.unlink();detail.unlink();added+=1
        print(json.dumps(result),flush=True)
    receipts=[json.loads(p.read_text()) for p in sorted((root/'receipts').glob('*.json'))]
    result={'status':'FULL_PARTITION_CANDIDATE_MEASURED' if len(receipts)==12288 else 'INCOMPLETE',
            'files':len(receipts),'rows':sum(r['rows'] for r in receipts),'source_bytes':sum(r['source_bytes'] for r in receipts),
            'detail_bytes':sum(r['detail_bytes'] for r in receipts),'full_serving_bytes':None}
    save(root/'progress.json',result)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('rows_manifest',type=Path);p.add_argument('md5_manifest',type=Path);p.add_argument('--max-files',type=int,default=0)
    a=p.parse_args();main(a.root,a.rows_manifest,a.md5_manifest,a.max_files)
