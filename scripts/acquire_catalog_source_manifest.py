#!/usr/bin/env python3
"""Acquire explicit complete source files into owned scratch, with audited receipts.

This measures sources only. It neither builds serving artifacts nor admits data.
"""
import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.error
import urllib.request


def save(path,value):
    temporary=path.with_suffix('.json.tmp')
    with temporary.open('w') as f:
        json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    temporary.replace(path)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest',type=Path);parser.add_argument('root',type=Path)
    args=parser.parse_args();args.root.mkdir(parents=True,exist_ok=True)
    lock=(args.root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    pinned=args.root/'manifest.json'
    document=json.loads(args.manifest.read_text())
    if pinned.exists() and json.loads(pinned.read_text())!=document:raise ValueError('manifest changed')
    if not pinned.exists():save(pinned,document)
    for item in document['files']:
        key=item['id']
        if Path(key).name!=key:raise ValueError('unsafe file identifier')
        receipt=args.root/(key+'.json')
        if receipt.exists():continue
        result={'id':key,'catalog':item['catalog'],'expected_rows':item['rows'],'serving_artifacts':'unmeasured'}
        start=time.monotonic();attempts=[]
        for url in item['urls']:
            output=args.root/(key+'.source')
            try:
                if shutil.disk_usage(args.root).free<100*(1<<30):raise RuntimeError('100GiB headroom reached')
                h=hashlib.sha256();size=0
                with urllib.request.urlopen(url,timeout=60) as response,output.open('wb') as f:
                    for b in iter(lambda:response.read(1<<20),b''):
                        size+=len(b)
                        if size>item['max_source_bytes']:raise ValueError('source exceeds reviewed envelope')
                        if shutil.disk_usage(args.root).free<100*(1<<30):raise RuntimeError('headroom reached')
                        f.write(b);h.update(b)
                    f.flush();os.fsync(f.fileno())
                opener=gzip.open if url.endswith('.gz') else open
                with opener(output,'rb') as source:
                    rows=0;uncompressed=0
                    for line in source:rows+=1;uncompressed+=len(line)
                if rows!=item['rows']:raise ValueError(f'row count mismatch: {rows} != {item["rows"]}')
                result.update(status='full_source_measured',url=url,source_bytes=size,
                              allocated_bytes=output.stat().st_blocks*512,uncompressed_bytes=uncompressed,
                              rows=rows,sha256=h.hexdigest(),seconds=time.monotonic()-start,attempts=attempts)
                save(receipt,result);print(json.dumps(result),flush=True);break
            except (OSError,ValueError) as error:
                attempts.append({'url':url,'error':str(error)})
        else:
            result.update(status='INCOMPLETE_acquisition_failed',attempts=attempts)
            save(args.root/(key+'.failure.json'),result);print(json.dumps(result),flush=True)

if __name__=='__main__':main()
