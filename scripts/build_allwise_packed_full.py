#!/usr/bin/env python3
"""Resumable full AllWISE ID-map build with bounded external merge.

Only this builder's intermediate runs are recycled, after a complete next-stage
manifest is durable. Source projections and earlier trial artifacts are retained.
"""
import argparse
import csv
import fcntl
import json
import os
from pathlib import Path
import shutil
import time
import pyarrow.parquet as pq
from packed_catalog_id_lookup import locator,unpack_locator,write_run,read_run,merge,header,lookup
from measure_gaia_full_partitions import guard,save,sha


def durable(path,value):
    save(path,value)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def describe(path,rows):
    with path.open('rb') as f:
        if header(f)!=rows:raise ValueError('run accounting mismatch')
    return {'file':path.name,'rows':rows,'bytes':path.stat().st_size,
            'allocated_bytes':path.stat().st_blocks*512,'sha256':sha(path)}


def checked(root,r):
    if Path(r['file']).name!=r['file']:raise ValueError('unsafe run filename')
    path=root/r['file']
    if sha(path)!=r['sha256']:raise ValueError('completed run changed')
    return path


def merge_stage(root,inputs,stage,checkpoint,fan_in=64):
    if not 2<=fan_in<=64:raise ValueError('invalid fan-in')
    outputs=[]
    for group,start in enumerate(range(0,len(inputs),fan_in)):
        subset=inputs[start:start+fan_in];path=root/f's{stage:03d}-{group:05d}.scid'
        receipt=path.with_suffix('.receipt.json')
        if receipt.exists():
            r=json.loads(receipt.read_text())
            if r['inputs']!=subset:raise ValueError('merge inputs changed')
            checked(root,r)
        else:
            count=merge([checked(root,r) for r in subset],path,checkpoint)
            if count!=sum(r['rows'] for r in subset):raise ValueError('merge row loss')
            r=describe(path,count);r['inputs']=subset;durable(receipt,r)
        outputs.append({k:v for k,v in r.items() if k!='inputs'})
    # Commit the entire stage before removing any prior-stage files. A restart
    # always finds the newest complete stage, with all its runs still present.
    durable(root/f'stage-{stage:03d}.json',{'stage':stage,'runs':outputs})
    for r in inputs:
        path=root/r['file']
        if not path.name.startswith(f's{stage-1:03d}-'):raise ValueError('refusing non-intermediate cleanup')
        path.unlink(missing_ok=True)
    return outputs


def build(source_root,root,rows_manifest,trial_root=None):
    if (source_root/'OWNER').read_text()!='SkyChart isolated full AllWISE measurement 1271\n':raise ValueError('unowned source')
    root.mkdir(parents=True,exist_ok=True)
    lock=(root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=root/'OWNER';marker='SkyChart isolated full packed AllWISE ID measurement 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in root.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'format':'SCID001','source_manifest_sha256':sha(source_root/'manifest.json'),'rows_manifest_sha256':sha(rows_manifest)}
    if (root/'manifest.json').exists() and json.loads((root/'manifest.json').read_text())!=pin:raise ValueError('release changed')
    if json.loads((source_root/'manifest.json').read_text())['rows_sha256']!=pin['rows_manifest_sha256']:raise ValueError('wrong source manifest')
    durable(root/'manifest.json',pin);started=time.time()
    observed_at=0
    workspace=json.loads((root/'workspace.json').read_text()) if (root/'workspace.json').exists() else {'peak_logical_bytes':0,'peak_allocated_bytes':0}
    def checkpoint():
        nonlocal observed_at
        guard(root,100*(1<<30))
        if time.monotonic()-observed_at>=10:
            observed_at=time.monotonic();sizes=[p.stat() for p in root.iterdir() if p.is_file()]
            workspace['peak_logical_bytes']=max(workspace['peak_logical_bytes'],sum(s.st_size for s in sizes))
            workspace['peak_allocated_bytes']=max(workspace['peak_allocated_bytes'],sum(s.st_blocks*512 for s in sizes))
            workspace.update(updated_unix=time.time(),instantaneous_peak_exact=False,scope='builder-owned named files; excludes unlinked and between-sample peaks')
            durable(root/'workspace.json',workspace)
    if (root/'measurement.json').exists():
        r=json.loads((root/'measurement.json').read_text());checked(root,r);return r
    stages=sorted(root.glob('stage-*.json'))
    if stages:
        stage=json.loads(stages[-1].read_text());runs=stage['runs'];level=stage['stage']
        for r in runs:checked(root,r)
        # Finish cleanup if an interruption followed a durable stage commit.
        for old_path in stages[:-1]:
            old=json.loads(old_path.read_text())
            for r in old['runs']:
                name=r['file']
                if Path(name).name!=name or not name.startswith(f"s{old['stage']:03d}-"):raise ValueError('unsafe intermediate cleanup')
                (root/name).unlink(missing_ok=True)
    else:
        files=list(csv.DictReader(rows_manifest.open()))
        if len(files)!=12288 or len({r['path'] for r in files})!=12288 or sum(int(r['nrows']) for r in files)!=747634026:raise ValueError('incomplete release manifest')
        prior=json.loads((trial_root/'measurement.json').read_text()) if trial_root else None
        runs=[]
        for file_id,item in enumerate(files):
            source_receipt=source_root/'receipts'/f'{file_id:05d}.json'
            while not source_receipt.exists():
                checkpoint();durable(root/'progress.json',{'status':'WAITING_FOR_SOURCE','file_id':file_id,'built_runs':len(runs)});time.sleep(30)
            source=json.loads(source_receipt.read_text())
            if not source['all_fields_verified'] or source['path']!=item['path'] or source['rows']!=int(item['nrows']):raise ValueError('invalid source receipt')
            path=root/f's000-{file_id:05d}.scid';receipt=path.with_suffix('.receipt.json')
            projection=source_root/'build-projections'/f'{file_id:05d}.parquet'
            if receipt.exists():
                r=json.loads(receipt.read_text())
                if r['projection_sha256']!=source['build_projection']['sha256']:raise ValueError('source changed')
                checked(root,r)
            else:
                checkpoint()
                if sha(projection)!=source['build_projection']['sha256']:raise ValueError('projection changed')
                table=pq.ParquetFile(projection)
                groups=[table.read_row_group(g,columns=['cntr'],use_threads=False)['cntr'].to_pylist() for g in range(table.num_row_groups)]
                if prior and str(file_id) in prior['input_counts']:
                    if prior['projection_sha256'][str(file_id)]!=sha(projection):raise ValueError('trial source changed')
                    # Reuse the completed sort, verifying every copied locator.
                    original=trial_root/f'{file_id}.run';count=0
                    for key,position in read_run(original):
                        fid,g,offset=unpack_locator(position)
                        if fid!=file_id or groups[g][offset]!=key:raise ValueError('trial locator changed')
                        count+=1
                    shutil.copyfile(original,path)
                    with path.open('rb') as f:os.fsync(f.fileno())
                else:
                    records=[(key,locator(file_id,g,offset)) for g,values in enumerate(groups) for offset,key in enumerate(values)]
                    count=write_run(path,sorted(records),checkpoint)
                if count!=source['rows']:raise ValueError('packed row accounting mismatch')
                r=describe(path,count);r['projection_sha256']=source['build_projection']['sha256'];durable(receipt,r)
            runs.append({k:v for k,v in r.items() if k!='projection_sha256'})
            durable(root/'progress.json',{'status':'BUILDING_SORTED_RUNS','built_runs':len(runs),'rows':sum(r['rows'] for r in runs)})
        level=0;durable(root/'stage-000.json',{'stage':0,'runs':runs})
    while len(runs)>1:
        level+=1;checkpoint();durable(root/'progress.json',{'status':'MERGING','stage':level,'input_runs':len(runs)})
        runs=merge_stage(root,runs,level,checkpoint)
    r=runs[0];path=checked(root,r)
    if r['rows']!=747634026:raise ValueError('full global record count mismatch')
    # A complete scan validates global sorting, uniqueness and locator bounds.
    count=sum(1 for _ in read_run(path))
    if count!=r['rows']:raise ValueError('final ID count differs')
    r.update(status='FULL_ID_COMPONENT_MEASURED',source_manifest_sha256=pin['source_manifest_sha256'],
             seconds=time.time()-started,full_serving_bytes=None,
             remaining=['designation lookup','angular artifacts','native integration and full-detail hydration'])
    durable(root/'measurement.json',r);durable(root/'progress.json',{'status':r['status'],'rows':count});return r


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source_root',type=Path);p.add_argument('root',type=Path);p.add_argument('rows_manifest',type=Path);p.add_argument('--trial-root',type=Path)
    a=p.parse_args();print(json.dumps(build(a.source_root,a.root,a.rows_manifest,a.trial_root)))
