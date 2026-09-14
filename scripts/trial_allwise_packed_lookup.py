#!/usr/bin/env python3
"""Measure a merged ID index against four complete, verified AllWISE inputs."""
import argparse
import json
from pathlib import Path
import time
import pyarrow.parquet as pq
from packed_catalog_id_lookup import locator,unpack_locator,write_run,merge,read_run,lookup
from measure_gaia_full_partitions import save,sha


def trial(root,output):
    if (root/'OWNER').read_text()!='SkyChart isolated full AllWISE measurement 1271\n':raise ValueError('unowned source')
    output.mkdir(exist_ok=False);(output/'OWNER').write_text('SkyChart isolated packed lookup trial 1271\n')
    started=time.monotonic();inputs={};runs=[];counts={};source_checksums={}
    for file_id in [0,1091,8274,8438]:
        receipt=json.loads((root/'receipts'/f'{file_id:05d}.json').read_text())
        projection=root/'build-projections'/f'{file_id:05d}.parquet'
        if sha(projection)!=receipt['build_projection']['sha256'] or not receipt['all_fields_verified']:raise ValueError('unverified input')
        table=pq.ParquetFile(projection)
        groups=[table.read_row_group(g,columns=['cntr'],use_threads=False)['cntr'].to_pylist() for g in range(table.num_row_groups)]
        items=[(key,locator(file_id,g,offset)) for g,values in enumerate(groups) for offset,key in enumerate(values)]
        if len(items)!=receipt['rows']:raise ValueError('input count mismatch')
        run=output/f'{file_id}.run';write_run(run,sorted(items));runs.append(run)
        inputs[file_id]=groups;counts[str(file_id)]=len(items);source_checksums[str(file_id)]=sha(projection)
    index=output/'ids.scid';rows=merge(runs,index)
    if rows!=sum(counts.values()):raise ValueError('merged row accounting mismatch')
    samples=[];verified=0
    for key,position in read_run(index):
        file_id,group,offset=unpack_locator(position)
        if inputs[file_id][group][offset]!=key:raise ValueError('merged locator differs from owned input')
        if verified%10000==0:samples.append((key,(file_id,group,offset)))
        verified+=1
    latencies=[]
    for key,expected in samples:
        start=time.perf_counter()
        if lookup(index,key)!=expected:raise ValueError('binary lookup differs')
        latencies.append((time.perf_counter()-start)*1000)
    result={'status':'PARTIAL_RELEASE_ID_COMPONENT_MEASURED','rows':rows,'files':4,'input_counts':counts,
            'projection_sha256':source_checksums,'source_manifest_sha256':sha(root/'manifest.json'),
            'logical_bytes':index.stat().st_size,'allocated_bytes':index.stat().st_blocks*512,'sha256':sha(index),
            'first_partition_run_bytes':(output/'0.run').stat().st_size,'all_locators_verified':verified,
            'warm_lookup_samples':len(samples),'warm_lookup_max_ms':max(latencies),'seconds':time.monotonic()-started,
            'owned_trial_named_bytes':sum(p.stat().st_size for p in output.iterdir() if p.is_file()),
            'full_serving_bytes':None,'remaining':['full-volume external merge','designation lookup','angular artifacts','native integration and full-detail hydration']}
    save(output/'measurement.json',result);print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('output',type=Path);a=p.parse_args();trial(a.root,a.output)
