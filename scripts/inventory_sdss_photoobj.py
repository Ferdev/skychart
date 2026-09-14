#!/usr/bin/env python3
"""Checkpoint SDSS rsync file metadata by run; never treat listing bytes as measured data."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import time
from inventory_legacy_tractor import save

BASE = 'rsync://dtn.sdss.org/dr18/prior-surveys/sdss4-dr17-eboss/photoObj/301/'


def parse(raw):
    entries = {}
    for line in raw.decode('utf-8').splitlines():
        m = re.fullmatch(r'([d-][rwxstST-]{9})\s+([\d,]+)\s+(\d{4}/\d\d/\d\d \d\d:\d\d:\d\d) (.+)', line)
        if not m:
            raise ValueError('unrecognized rsync listing line: '+line[:120])
        name = m[4]
        if name in entries or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
            raise ValueError('duplicate or unsafe listing path')
        entries[name] = {'directory': m[1][0]=='d', 'bytes': int(m[2].replace(',', '')), 'modified': m[3]}
    if not entries or '.' not in entries:
        raise ValueError('empty or missing listing root')
    return entries


def fetch(host, output, name, suffix, recursive):
    raw_path = output/(name+'.txt'); receipt_path = output/(name+'.json')
    url = BASE+suffix
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text()); raw = raw_path.read_bytes()
        if receipt['url']!=url or receipt['sha256']!=hashlib.sha256(raw).hexdigest():
            raise ValueError('changed accepted listing')
        return parse(raw)
    args=['rsync','--no-motd','--list-only','--contimeout=10','--timeout=60']
    if recursive: args.append('--recursive')
    command=shlex.join(args+[url])
    for attempt in range(3):
        result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,command],capture_output=True)
        if result.returncode==0: break
        (output/(name+'.stderr')).write_bytes(result.stderr)
        if attempt==2: raise RuntimeError('rsync failed '+name+': '+str(result.returncode))
        time.sleep(5*(attempt+1))
    entries=parse(result.stdout)
    with raw_path.open('wb') as f:
        f.write(result.stdout); f.flush(); os.fsync(f.fileno())
    save(receipt_path, {'url':url,'observed_unix':time.time(),'exit_code':0,
        'bytes':len(result.stdout),'sha256':hashlib.sha256(result.stdout).hexdigest(),
        'scope':'Provider listing metadata only; no scientific source bytes downloaded'})
    return entries


def run(host, output):
    if host.startswith('-'): raise ValueError('invalid SSH host')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w'); fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    owner=output/'OWNER'; marker='SkyChart isolated SDSS metadata investigation 1271\n'
    if owner.exists():
        if owner.read_text()!=marker: raise ValueError('unowned directory')
    else:
        if any(p.name!='.lock' for p in output.iterdir()): raise ValueError('nonempty unowned directory')
        owner.write_text(marker)
    root=fetch(host,output,'root','',False)
    runs=sorted(n for n,e in root.items() if e['directory'] and re.fullmatch(r'\d+',n))
    if not runs: raise ValueError('no runs')
    if any(e['directory'] and n!='.' and n not in runs for n,e in root.items()):
        raise ValueError('unaccounted root directory')
    totals={}; completed=0
    for run_id in runs:
        entries=fetch(host,output,'run-'+run_id,run_id+'/',True)
        for name,e in entries.items():
            if e['directory']: continue
            kind='photoObj' if re.fullmatch(r'[1-6]/photoObj-\d{6}-[1-6]-\d{4}\.fits',name) else 'auxiliary'
            group=totals.setdefault(kind,{'files':0,'provider_reported_bytes':0})
            group['files']+=1; group['provider_reported_bytes']+=e['bytes']
        completed+=1
        report={'status':'FULL_PROVIDER_LISTING_PINNED' if completed==len(runs) else 'INCOMPLETE_PROVIDER_LISTING',
            'completed_runs':completed,'expected_runs':len(runs),'groups':totals,
            'source_bytes_measured':None,'catalog_rows':None,'full_serving_bytes':None,
            'scope':'Directory sizes only. Source checksums/schema/rows/calibration coherence and serving builds still required.'}
        save(output/'progress.json',report)
        print(json.dumps({'run':run_id,'completed':completed,'expected':len(runs)}),flush=True)
    save(output/'inventory.json',report)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('host');p.add_argument('output',type=Path)
    a=p.parse_args(); print(json.dumps(run(a.host,a.output)))
