#!/usr/bin/env python3
"""Sequentially copy verified PSC build inputs to an owned isolated SSH directory.

Publish receipts last; interrupted transfers never become eligible build inputs.
No source/detail file is removed, and no application database is accessed.
"""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import time

from measure_gaia_full_partitions import save


def run_transport(command, retry_receipt=None, **kwargs):
    """Retry SSH/SFTP transport exits only; callers must use idempotent writes."""
    for attempt in range(4):
        try:
            return subprocess.run(command, check=True, **kwargs)
        except subprocess.CalledProcessError as error:
            if error.returncode != 255 or attempt == 3:
                raise
            delay = 5 * 2**attempt
            if retry_receipt is not None:
                save(retry_receipt, {'status':'RETRYING_TRANSPORT','program':command[0],
                     'returncode':error.returncode,'attempt':attempt+1,
                     'retry_seconds':delay,'observed_unix':time.time()})
            time.sleep(delay)


def sync(root, host, destination):
    if host.startswith('-') or not destination.startswith('/'):
        raise ValueError('invalid SSH destination')
    marker = 'SkyChart exhaustive PSC investigation 1271\n'
    if (root/'OWNER').read_text() != marker:
        raise ValueError('unowned local inputs')
    lock = (root/'remote-sync.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    def remote(command):
        return run_transport(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,command],
                             root/'remote-sync-retry.json',capture_output=True,text=True).stdout
    def target(name):
        return shlex.quote(destination+'/'+name)
    if remote('cat '+target('OWNER')) != marker:
        raise ValueError('unowned remote directory')
    if remote('cat '+target('manifest.json')) != (root/'manifest.json').read_text():
        raise ValueError('remote release manifest mismatch')
    names=[r['file'] for r in json.loads((root/'manifest.json').read_text())['files']]
    if len(names)!=92 or len(set(names))!=92 or any(Path(n).name!=n for n in names):
        raise ValueError('invalid complete PSC manifest')
    for index,name in enumerate(names):
        receipt=root/'receipts'/(name+'.json')
        while not receipt.exists():
            save(root/'remote-sync-progress.json',{'status':'WAITING_FOR_VERIFIED_INPUT','file':name,'files':index})
            time.sleep(30)
        data=receipt.read_bytes();r=json.loads(data)
        if r['source_file']!=name or not r['all_fields_verified']:
            raise ValueError('unverified receipt')
        projection=r['build_projection']['file']
        if Path(projection).name!=projection:
            raise ValueError('unsafe projection name')
        checksum=hashlib.sha256(data).hexdigest()
        existing=remote('if test -f '+target('receipts/'+name+'.json')+'; then sha256sum '+target('receipts/'+name+'.json')+'; fi')
        if existing:
            if existing.split()[0]!=checksum:
                raise ValueError('remote receipt changed')
        else:
            # This floor protects shared disk headroom; the index worker also
            # guards its own writes. It is not a user-imposed scratch quota.
            free=int(remote('df -B1 --output=avail '+shlex.quote(destination)+' | tail -n 1').strip())
            if free < 100*(1<<30)+(root/'build-projections'/projection).stat().st_size:
                raise RuntimeError('remote free-space headroom guard')
            save(root/'remote-sync-progress.json',{'status':'TRANSFERRING','file':name,'files':index})
            for source, relative in [(root/'build-projections'/projection,'build-projections/'+projection),
                                      (receipt,'receipts/'+name+'.json')]:
                # SFTP-backed scp; bandwidth bounded to 40 Mbit/s.
                run_transport(['scp','-q','-l','40000','-o','BatchMode=yes',str(source),
                               host+':'+destination+'/'+relative+'.incoming'],root/'remote-sync-retry.json')
            for relative in ['build-projections/'+projection,'receipts/'+name+'.json']:
                # A transport disconnect may occur after a successful rename.
                # Repeating publication is safe, and receipts still publish last.
                incoming=target(relative+'.incoming');final=target(relative)
                remote('if test -f '+incoming+'; then mv '+incoming+' '+final+'; else test -f '+final+'; fi')
        save(root/'remote-sync-progress.json',{'status':'INCOMPLETE','files':index+1,
             'last_file':name,'receipt_sha256':checksum,'updated_unix':time.time()})
    save(root/'remote-sync-progress.json',{'status':'ALL_92_INPUTS_TRANSFERRED','files':92,
         'full_serving_bytes':None,'updated_unix':time.time()})


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('root',type=Path);p.add_argument('host');p.add_argument('destination')
    a=p.parse_args();sync(a.root,a.host,a.destination)
