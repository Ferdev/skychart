#!/usr/bin/env python3
"""Reuse completed AllWISE candidate measurements; create only build projections."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import pyarrow as pa
import pyarrow.parquet as pq
from measure_allwise_full_partitions import COLUMNS,FORMAT
from measure_gaia_full_partitions import save,sha
from recompress_catalog_partitions import equal_values


def seed(root, previous, sources, rows_manifest, md5_manifest):
    if (root/'OWNER').read_text()!='SkyChart isolated full AllWISE measurement 1271\n':raise ValueError('unowned root')
    prior=json.loads(previous.read_text())
    if prior['codec']!='zstd-3' or prior['row_group_size']!=4096 or prior.get('byte_stream_split_floats',False):raise ValueError('different measured encoding')
    rows=list(csv.DictReader(rows_manifest.open()))
    checksums={line.split()[1]:line.split()[0] for line in md5_manifest.read_text().splitlines() if line.strip()}
    for r in prior['partitions']:
        pixel=re.fullmatch(r'allwise-(\d+)\.parquet',r['source'])
        if not pixel or not r['all_values_schema_and_nulls_verified']:raise ValueError('unverified prior measurement')
        matches=[(i,x) for i,x in enumerate(rows) if '/healpix_k5='+pixel[1]+'/' in x['path']]
        if len(matches)!=1:raise ValueError('ambiguous prior partition')
        index,item=matches[0];receipt=root/'receipts'/f'{index:05d}.json'
        if receipt.exists():continue
        source=sources/r['source']
        if sha(source)!=r['source_sha256'] or int(item['nrows'])!=r['rows']:raise ValueError('prior source changed')
        with source.open('rb') as f:md5=hashlib.file_digest(f,'md5').hexdigest()
        if md5!=checksums[item['path']]:raise ValueError('prior provider checksum mismatch')
        original=pq.ParquetFile(source)
        subset=pa.schema([original.schema_arrow.field(n) for n in COLUMNS],metadata={b'purpose':b'global build input, not full detail or serving artifact'})
        projection=root/'build-projections'/f'{index:05d}.parquet'
        with pq.ParquetWriter(projection,subset,compression='zstd',compression_level=3,use_dictionary=False) as writer:
            for batch in original.iter_batches(batch_size=4096,columns=COLUMNS,use_threads=False):
                writer.write_table(pa.Table.from_batches([batch]).replace_schema_metadata(subset.metadata),row_group_size=4096)
        for a,b in zip(original.iter_batches(batch_size=4096,columns=COLUMNS,use_threads=False),pq.ParquetFile(projection).iter_batches(batch_size=4096,use_threads=False),strict=True):
            if not equal_values(pa.Table.from_batches([a]).replace_schema_metadata(subset.metadata),pa.Table.from_batches([b])):raise ValueError('projection loss')
        result={'format':FORMAT,'path':item['path'],'rows':r['rows'],'columns':r['columns'],
                'provider_md5':md5,'source_sha256':r['source_sha256'],'source_bytes':r['source_bytes'],
                'detail_bytes':r['candidate_bytes'],'detail_allocated_bytes':r['candidate_allocated_bytes'],'detail_sha256':r['candidate_sha256'],
                'build_projection':{'file':projection.name,'bytes':projection.stat().st_size,'sha256':sha(projection)},
                'all_fields_verified':True,'prior_measurement_sha256':sha(previous),'measurement_origin':'completed task-container measurement, reused without repeating conversion',
                'seconds':None,'prior_build_seconds':r['build_seconds'],'full_serving_bytes':None}
        save(receipt,result);print(json.dumps({'reused':r['source'],'index':index}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['root','previous','sources','rows_manifest','md5_manifest']:p.add_argument(name,type=Path)
    a=p.parse_args();seed(a.root,a.previous,a.sources,a.rows_manifest,a.md5_manifest)
