#!/usr/bin/env python3
"""Resume the already-created full Quaia export; never create duplicate jobs."""
import argparse
import csv
import fcntl
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request
from urllib.parse import urlencode
from acquire_catalog_source_manifest import save
from audit_votable_source import audit


def finish(root):
    lock=(root/'.export.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    job=json.loads((root/'job.json').read_text());base=job['response_url']
    if not base.startswith('https://irsa.ipac.caltech.edu/TAP/async/') or not base.rsplit('/',1)[1].isdigit():
        raise ValueError('unexpected archive job URL')
    if job['params']!={'QUERY':'SELECT * FROM quaia','FORMAT':'votable','MAXREC':'2000000','PHASE':'RUN'}:
        raise ValueError('query scope changed')
    count=list(csv.DictReader((root/'count.csv').open()))
    if count!=[{'n':'1295502'}]:raise ValueError('unexpected source row contract')
    columns=list(csv.DictReader((root/'columns.csv').open()))
    expected={r['column_name']:r['datatype'] for r in columns}
    if len(expected)!=24:raise ValueError('source schema changed')
    if (root/'receipt.json').exists():return json.loads((root/'receipt.json').read_text())
    while True:
        with urllib.request.urlopen(base+'/phase',timeout=60) as r:phase=r.read().decode().strip()
        save(root/'progress.json',{'status':'ARCHIVE_'+phase,'job_url':base})
        if phase=='COMPLETED':break
        if phase not in {'EXECUTING','QUEUED','PENDING'}:raise ValueError('archive job failed: '+phase)
        time.sleep(30)
    with urllib.request.urlopen(base,timeout=60) as r:(root/'completed-job.xml').write_bytes(r.read())
    source=root/'full-source.xml'
    if not source.exists():
        url=base+'/results/result';part=root/'full-source.partial';size=0;started=time.monotonic()
        # The result endpoint lacks a stable range validator. A failed download
        # restarts only this uncommitted file; the durable export job is reused.
        with urllib.request.urlopen(url,timeout=120) as response,part.open('wb') as f:
            expected_bytes=int(response.headers['Content-Length']) if response.headers.get('Content-Length') else None
            save(root/'response-headers.json',dict(response.headers))
            while block:=response.read(1<<20):
                if shutil.disk_usage(root).free<100<<30:raise RuntimeError('live headroom guard reached')
                f.write(block);size+=len(block)
                if size%(8<<20)==0:save(root/'progress.json',{'status':'DOWNLOADING_COMPLETED_EXPORT','bytes':size,'provider_bytes':expected_bytes})
                time.sleep(max(0,size/(2<<20)-(time.monotonic()-started)))
            f.flush();os.fsync(f.fileno())
        if expected_bytes is not None and size!=expected_bytes:raise ValueError('truncated export')
        part.replace(source)
    save(root/'progress.json',{'status':'AUDITING_ALL_ROWS_AND_FIELDS'})
    result=audit(source,1295502)
    actual={r['attributes']['name']:r['attributes']['datatype'] for r in result['fields']}
    if actual!=expected:raise ValueError('export schema differs from pinned archive schema')
    url='https://irsa.ipac.caltech.edu/TAP/sync?'+urlencode({'QUERY':'SELECT count(*) AS n FROM quaia','FORMAT':'csv'})
    with urllib.request.urlopen(url,timeout=60) as r:after=r.read()
    (root/'count-after.csv').write_bytes(after)
    if list(csv.DictReader(after.decode().splitlines()))!=count:raise ValueError('source row count changed')
    result.update(job_url=base,source_release='IRSA Quaia / DOI 10.26131/IRSA640, linked to Zenodo 10403370',
                  original_distribution_byte_equivalence=False,
                  archive_added_fields=['x','y','z','spt_ind','htm20','cntr'],
                  coverage_note='Full archived table; selection functions and original FITS byte equivalence not measured; archive auxiliary coordinates are not physical distances')
    save(root/'receipt.json',result);save(root/'progress.json',{'status':result['status'],'rows':result['rows'],'source_bytes':result['source_bytes']})
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    r=finish(a.root);print(json.dumps({k:v for k,v in r.items() if k not in {'fields','empty_cell_counts'}}))
