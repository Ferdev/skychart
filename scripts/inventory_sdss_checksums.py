#!/usr/bin/env python3
"""Acquire and reconcile published per-run SDSS checksum files; metadata only."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.request
from inventory_sdss_photoobj import parse as parse_listing
from inventory_legacy_tractor import save


def parse(raw, expected):
    records={}
    for line in raw.decode('ascii').splitlines():
        match=re.fullmatch(r'([0-9a-f]{40})\s+\*?(\S+)',line)
        if not match:raise ValueError('invalid checksum line')
        name=match[2].removeprefix('./')
        if name not in expected or name in records:raise ValueError('unknown or duplicate checksum filename')
        records[name]=match[1]
    if set(records)!=set(expected):raise ValueError('checksum file does not cover full listed run')
    return records


def run(listing_root,output,existing=None):
    verification=json.loads((listing_root/'verification.json').read_text())
    assert verification['status']=='COMPLETE_PROVIDER_FILE_LISTING_VERIFIED_NOT_MEASURED_SOURCE'
    inventory=json.loads((listing_root/'checksum-file-inventory.json').read_text())['files']
    assert len(inventory)==765
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated SDSS checksum metadata 1271\n';owner=output/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'listing_inventory_sha256':verification['inventory_sha256'],'files':inventory}
    if (output/'manifest.json').exists():
        if json.loads((output/'manifest.json').read_text())!=pin:raise ValueError('listing changed')
    else:save(output/'manifest.json',pin)
    completed=rows=total=0;errors=[]
    for item in inventory:
        name=item['file'];run_id=item['run'];path=output/name;receipt_path=output/(name+'.json')
        raw_listing=(listing_root/('run-'+run_id+'.txt')).read_bytes()
        listing_receipt=json.loads((listing_root/('run-'+run_id+'.json')).read_text())
        assert hashlib.sha256(raw_listing).hexdigest()==listing_receipt['sha256']
        expected={n for n,v in parse_listing(raw_listing).items() if not v['directory'] and n!=name}
        url='https://data.sdss.org/sas/dr18/prior-surveys/sdss4-dr17-eboss/photoObj/301/'+run_id+'/'+name
        if receipt_path.exists():
            r=json.loads(receipt_path.read_text());raw=path.read_bytes()
            assert hashlib.sha256(raw).hexdigest()==r['sha256'] and r['url']==url
            records=parse(raw,expected)
        else:
            for attempt in range(3):
                try:
                    if existing and name==existing.name:
                        raw=existing.read_bytes()
                        prior=json.loads(existing.with_name(existing.name+'.receipt.json').read_text())
                        assert hashlib.sha256(raw).hexdigest()==prior['sha256']
                    else:
                        with urllib.request.urlopen(url,timeout=60) as response:raw=response.read()
                    if len(raw)!=item['provider_reported_bytes']:raise ValueError('provider manifest size mismatch')
                    records=parse(raw,expected)
                    with path.open('wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
                    r={'url':url,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'source_files_covered':len(records),'observed_unix':time.time(),'scope':'Actual checksum-file bytes, not scientific source bytes'}
                    save(receipt_path,r);break
                except (OSError,ValueError) as error:
                    if attempt==2:r=None;errors.append({'run':run_id,'error':str(error)})
                    else:time.sleep(5*(attempt+1))
            time.sleep(1)
            if r is None:
                save(output/'errors.json',errors);continue
        completed+=1;rows+=len(records);total+=len(raw)
        progress={'status':'INCOMPLETE_CHECKSUM_METADATA','completed_runs':completed,'expected_runs':765,'source_file_checksums':rows,'checksum_metadata_bytes':total,'errors':errors,'full_source_bytes':None,'full_serving_bytes':None}
        save(output/'progress.json',progress);print(json.dumps({'run':run_id,'completed':completed}),flush=True)
    result={'status':'COMPLETE_CHECKSUM_METADATA_ONLY' if completed==765 and not errors else 'INCOMPLETE_CHECKSUM_METADATA','completed_runs':completed,'expected_runs':765,'source_file_checksums':rows,'checksum_metadata_bytes':total,'errors':errors,'full_source_bytes':None,'full_serving_bytes':None}
    save(output/'measurement.json',result);save(output/'progress.json',result)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('listing_root',type=Path);p.add_argument('output',type=Path);p.add_argument('--existing',type=Path)
    a=p.parse_args();print(json.dumps(run(a.listing_root,a.output,a.existing)))
