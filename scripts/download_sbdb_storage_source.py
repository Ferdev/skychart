#!/usr/bin/env python3
"""Measure one full-precision, unfiltered SBDB query using bounded memory.

Resume retains a completed raw download; interrupted mutable exports restart
as a complete query rather than combining pages from different snapshots.
"""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import os
import shutil
import time
import urllib.request
import urllib.parse
import ijson
from download_exoplanet_storage_source import save


def audit(path, fields, category=None):
    if not fields or fields[0] != 'spkid':
        raise ValueError('ordered source audit requires spkid as first field')
    found=[]; count=None; rows=0; width=0; prior=None; signature={}
    with path.open('rb') as f:
        for prefix,event,value in ijson.parse(f):
            if prefix=='fields.item':found.append(value)
            elif prefix=='count':count=int(value)
            elif prefix.startswith('signature.') and event in {'string','number'}:signature[prefix]=str(value)
            elif prefix=='data.item' and event=='start_array':width=0
            elif prefix=='data.item.item' and event in {'string','number','null','boolean'}:
                if width==0:
                    key=int(value)
                    if prior is not None and key<=prior:raise ValueError('source IDs duplicate or out of order')
                    prior=key
                if category is not None and width == len(fields)-1 and value != category:
                    raise ValueError('source category mismatch')
                width+=1
            elif prefix=='data.item' and event=='end_array':
                if width!=len(fields):raise ValueError('source field count mismatch')
                rows+=1
    if found!=fields or count is None or rows!=count:raise ValueError('full query accounting or schema mismatch')
    with path.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    return {'status':'complete_query_source_audited','rows':rows,'fields':found,'columns':len(found),
            'response_count':count,'signature':signature,'source_bytes':path.stat().st_size,
            'allocated_bytes':path.stat().st_blocks*512,'sha256':digest,'normalized_bytes':None,'full_serving_bytes':None}


def main(root, metadata, category=None):
    if category is not None and category not in {'an','au','cn','cu'}:
        raise ValueError('unsupported SBDB category')
    root.mkdir(parents=True,exist_ok=True)
    lock=(root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated full SBDB storage investigation 1271\n';owner=root/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in root.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    schema=json.loads(metadata.read_text())
    fields=[f['name'] for group in schema['info']['field'].values() for f in group['list']]+['kind']
    if len(fields)!=80 or len(set(fields))!=80:raise ValueError('expected pinned 79 fields plus verified kind')
    query={'fields':','.join(fields),'full-prec':'true','sort':'spkid'}
    if category is not None:
        query.update({'sb-kind':category[0], 'sb-ns':category[1]})
    url='https://ssd-api.jpl.nasa.gov/sbdb_query.api?'+urllib.parse.urlencode(query)
    manifest={'url':url,'fields':fields,'provider_metadata_sha256':hashlib.sha256(metadata.read_bytes()).hexdigest()}
    pin=root/'manifest.json'
    if pin.exists() and json.loads(pin.read_text())!=manifest:raise ValueError('pinned source contract changed')
    if not pin.exists():save(pin,manifest)
    source=root/'full.json';download=root/'download.receipt.json'
    if not download.exists():
        started=time.time();size=0
        save(root/'progress.json',{'status':'REQUESTING','started_unix':started,'url':url})
        with urllib.request.urlopen(url,timeout=600) as response,(root/'full.json.partial').open('wb') as f:
            while b:=response.read(1<<20):
                if shutil.disk_usage(root).free<100*(1<<30):raise RuntimeError('free-space headroom guard')
                f.write(b);size+=len(b)
                if size%(16<<20)==0:save(root/'progress.json',{'status':'DOWNLOADING','bytes':size,'started_unix':started})
            f.flush();os.fsync(f.fileno())
        (root/'full.json.partial').replace(source)
        save(download,{'started_unix':started,'finished_unix':time.time(),'bytes':size,'url':url})
    save(root/'progress.json',{'status':'AUDITING','bytes':source.stat().st_size})
    try:
        result=audit(source,fields,category)
    except (ValueError, ijson.JSONError, OSError) as error:
        save(root/'progress.json',{'status':'INCOMPLETE_INVALID_SOURCE',
             'bytes':source.stat().st_size,'error_type':type(error).__name__,
             'error':str(error),'source_retained':True,'full_serving_bytes':None})
        raise
    result.update(download=json.loads(download.read_text()),category=category,
                  snapshot_semantics='Single full query within declared category; not a named immutable upstream release' if category else 'Single unfiltered full query; not a named immutable upstream release',parser='ijson '+ijson.__version__)
    save(root/'receipt.json',result);save(root/'progress.json',{'status':result['status'],'rows':result['rows'],'bytes':result['source_bytes']})
    print(json.dumps(result),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('metadata',type=Path)
    p.add_argument('--category',choices=['an','au','cn','cu'])
    a=p.parse_args();main(a.root,a.metadata,a.category)
