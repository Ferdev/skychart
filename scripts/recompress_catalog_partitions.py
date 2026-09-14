#!/usr/bin/env python3
"""Lossless schema/value-preserving recompression of bounded owned Parquet files.

Measurements apply only to the files actually processed, never the full catalog.
"""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import time

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from investigate_catalog_storage import check, footprint, timing


def equal_values(left,right):
    if not left.schema.equals(right.schema,check_metadata=True) or left.num_rows!=right.num_rows:
        return False
    for a,b in zip(left.columns,right.columns):
        if a.equals(b):continue
        if not a.is_null().equals(b.is_null()):return False
        if not pa.types.is_floating(a.type):return False
        matches=pc.or_(pc.equal(a,b),pc.and_(pc.is_nan(a),pc.is_nan(b)))
        if not pc.all(pc.fill_null(matches,True)).as_py():return False
    return True


def run(inputs,output,row_group_size=4096,byte_stream_split=False):
    if row_group_size<0 or row_group_size>131072:
        raise ValueError('bounded row group size required')
    output.mkdir(parents=True,exist_ok=False)
    reports=[]
    for source in inputs:
        if source.stat().st_size>64*1024**2:raise ValueError('64 MiB input-file cap')
        check(output.parent)
        file=pq.ParquetFile(source)
        schema=file.schema_arrow
        target=output/source.name
        start=time.monotonic();rows=0
        encoding={}
        if byte_stream_split:
            encoding={'use_dictionary':[f.name for f in schema if not pa.types.is_floating(f.type)],
                      'use_byte_stream_split':[f.name for f in schema if pa.types.is_floating(f.type)]}
        with pq.ParquetWriter(target,schema,compression='zstd',compression_level=3,
                             write_statistics=True,**encoding) as writer:
            if row_group_size==0:
                if any(file.metadata.row_group(i).num_rows>131072 for i in range(file.metadata.num_row_groups)):
                    raise ValueError('original row group exceeds 131072-row budget')
                batches=(file.read_row_group(i,use_threads=False) for i in range(file.metadata.num_row_groups))
            else:
                batches=file.iter_batches(batch_size=row_group_size,use_threads=False)
            for batch in batches:
                if batch.nbytes>256*1024**2:
                    raise ValueError('Arrow batch exceeds 256 MiB working-data budget')
                if row_group_size==0:writer.write_table(batch,row_group_size=batch.num_rows)
                else:writer.write_batch(batch,row_group_size=row_group_size)
                rows+=batch.num_rows
                check(output.parent)
                if time.monotonic()-start>120:raise TimeoutError('per-partition conversion cap')
        build_seconds=time.monotonic()-start
        converted=pq.ParquetFile(target)
        verified=0
        for a,b in zip(file.iter_batches(batch_size=4096,use_threads=False),
                       converted.iter_batches(batch_size=4096,use_threads=False),strict=True):
            if not equal_values(a,b):raise ValueError('schema/value/null loss during recompression')
            verified+=a.num_rows
        assert verified==rows==file.metadata.num_rows==converted.metadata.num_rows
        def retrieve_first():
            return converted.read_row_group(0,use_threads=False).slice(0,1)
        reports.append({'source':source.name,'rows':rows,'columns':len(schema),
                        'source_bytes':source.stat().st_size,'source_allocated_bytes':source.stat().st_blocks*512,
                        'source_sha256':hashlib.file_digest(source.open('rb'),'sha256').hexdigest(),
                        'candidate_bytes':target.stat().st_size,'candidate_allocated_bytes':target.stat().st_blocks*512,
                        'candidate_sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest(),
                        'build_seconds':build_seconds,'all_values_schema_and_nulls_verified':True,
                        'warm_first_row_group_detail':timing(retrieve_first),
                        'schema':str(schema)})
    result={'scope':'only listed owned AllWISE partitions; NOT a full-release measurement',
            'codec':'zstd-3','byte_stream_split_floats':byte_stream_split,
            'row_group_size':row_group_size or 'preserve source row groups','partitions':reports,
            'final_artifacts':footprint(output),'max_process_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'unknowns':['complete-catalog recompressed total','global ID/alias/crossmatch indexes','HTTP/browser/concurrent/cold latency',
                        'full-release build peak and rollback artifacts']}
    (output/'measurement.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--row-group-size',type=int,default=4096,help='0 preserves bounded source row groups')
    p.add_argument('--byte-stream-split',action='store_true',help='lossless float encoding; dictionary encoding for other types')
    p.add_argument('inputs',type=Path,nargs='+')
    a=p.parse_args();print(json.dumps(run(a.inputs,a.output,a.row_group_size,a.byte_stream_split),indent=2))
