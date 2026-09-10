#!/usr/bin/env python3
"""Acquire and audit one complete dated PSCompPars query on isolated scratch.

The upstream table is mutable. Interrupted transfers restart the whole query;
HTTP ranges must not splice results from different table states.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.parse
import urllib.request
from audit_votable_source import audit


def save(path,value):
    part=path.with_suffix('.json.tmp')
    with part.open('w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    part.replace(path)


def url(query,fmt):
    return 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?'+urllib.parse.urlencode({'query':query,'format':fmt,'MAXREC':'100000'})


def count():
    with urllib.request.urlopen(url('SELECT count(*) AS n FROM pscomppars','json'),timeout=120) as r:
        data=json.load(r)
    return int(data[0]['n'])


def main(root):
    root.mkdir(parents=True,exist_ok=True)
    lock=(root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=root/'OWNER';marker='SkyChart isolated exoplanet storage investigation 1271\n'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned directory')
    else:
        if any(p.name!='.lock' for p in root.iterdir()):raise ValueError('nonempty unowned directory')
        owner.write_text(marker)
    receipt=root/'receipt.json'
    if receipt.exists():
        old=json.loads(receipt.read_text())
        if old.get('status')=='complete_TABLEDATA_source_audited':
            with (root/'pscomppars.vot').open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
            if digest!=old['sha256']:raise ValueError('completed source changed')
            print(json.dumps({'status':'already_verified','rows':old['rows']}));return
    before=count();started=time.time();source_url=url('SELECT * FROM pscomppars','votable')
    save(root/'progress.json',{'status':'DOWNLOADING','rows_before':before,'started_unix':started,'url':source_url})
    size=0;part=root/'pscomppars.vot.partial'
    with urllib.request.urlopen(source_url,timeout=120) as response,part.open('wb') as f:
        while b:=response.read(1<<20):
            if shutil.disk_usage(root).free<100*(1<<30):raise RuntimeError('live free-space headroom guard')
            f.write(b);size+=len(b)
            if size%(16<<20)==0:save(root/'progress.json',{'status':'DOWNLOADING','bytes':size,'rows_before':before,'started_unix':started})
        f.flush();os.fsync(f.fileno())
    source=root/'pscomppars.vot';part.replace(source)
    after=count()
    if before!=after:raise ValueError('provider count changed across acquisition; snapshot reconciliation required')
    result=audit(source,before)
    result.update(url=source_url,provider_count_before=before,provider_count_after=after,
                  retrieval_started_unix=started,retrieval_finished_unix=time.time(),
                  snapshot_semantics='Single full TABLEDATA query; counts bracket acquisition. Not a named immutable upstream release; count stability does not prove all values unchanged.')
    save(receipt,result);save(root/'progress.json',{'status':result['status'],'rows':result['rows'],'bytes':result['source_bytes']})
    print(json.dumps({k:v for k,v in result.items() if k not in {'fields','empty_cell_counts'}}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();main(a.root)
