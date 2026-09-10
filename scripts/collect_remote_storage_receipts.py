#!/usr/bin/env python3
"""Read-only collection of isolated investigation receipts over SSH.

Receipts are snapshots of completed files, not a complete catalog/serving claim.
No application database is accessed and no command mutates the remote host.
"""
import argparse
import json
from pathlib import Path
import shlex
import subprocess
import time

from measure_gaia_full_partitions import save

REMOTE=r'''
import json,sys
from pathlib import Path
root=Path(sys.argv[1])
assert (root/'allwise-full/OWNER').read_text()=='SkyChart isolated full AllWISE measurement 1271\n'
receipts={p.name:json.loads(p.read_text()) for p in sorted((root/'allwise-full/receipts').glob('*.json'))}
paths={
 'psc-remote-evidence/full-build-progress.json':'psc-full/lookup.progress.json',
 'psc-remote-evidence/full-build-workspace.json':'psc-full/lookup.workspace.json',
 'sbdb-owned-evidence/progress.json':'sbdb-owned-storage-typed/progress.json',
 'sbdb-owned-evidence/measurement.json':'sbdb-owned-storage-typed/measurement.json',
 'vsx-source/fields.receipt.json':'vsx-field-audit/fields.receipt.json',
 'vsx-owned-evidence/progress.json':'vsx-owned-storage/progress.json',
 'vsx-owned-evidence/detail.receipt.json':'vsx-owned-storage/detail.receipt.json',
 'vsx-owned-evidence/measurement.json':'vsx-owned-storage/measurement.json',
 'openngc-owned-evidence/measurement.json':'openngc-owned-storage/measurement.json',
 'openngc-owned-evidence/evidence-index.json':'openngc-evidence-index/measurement.json',
 'erosita-main-source/fits-audit.json':'erosita-main-source/fits-audit.json',
 'erosita-ls10-evidence/progress.json':'erosita-ls10-audit/progress.json',
 'erosita-ls10-evidence/decompressed.receipt.json':'erosita-ls10-audit/decompressed.receipt.json',
 'erosita-ls10-evidence/fits-audit.json':'erosita-ls10-audit/fits-audit.json',
 'quaia-owned-evidence/progress.json':'quaia-owned-storage/progress.json',
 'quaia-owned-evidence/detail.receipt.json':'quaia-owned-storage/detail.receipt.json',
 'quaia-owned-evidence/measurement.json':'quaia-owned-storage/measurement.json',
 'nvss-owned-evidence/fields.receipt.json':'nvss-field-audit/fields.receipt.json',
 'nvss-owned-evidence/progress.json':'nvss-owned-storage/progress.json',
 'nvss-owned-evidence/detail.receipt.json':'nvss-owned-storage/detail.receipt.json',
 'nvss-owned-evidence/measurement.json':'nvss-owned-storage/measurement.json',
 'erosita-main-owned-evidence/progress.json':'erosita-main-owned-storage/progress.json',
 'erosita-main-owned-evidence/measurement.json':'erosita-main-owned-storage/measurement.json',
 'erosita-main-owned-evidence/exact-lookup-progress.json':'erosita-main-exact-lookup/progress.json',
 'erosita-main-owned-evidence/exact-lookup.json':'erosita-main-exact-lookup/measurement.json',
 'erosita-ls10-owned-evidence/progress.json':'erosita-ls10-owned-storage/progress.json',
 'erosita-ls10-owned-evidence/measurement.json':'erosita-ls10-owned-storage/measurement.json',
 'erosita-ls10-owned-evidence/exact-lookup-progress.json':'erosita-ls10-exact-lookup/progress.json',
 'erosita-ls10-owned-evidence/exact-lookup.json':'erosita-ls10-exact-lookup/measurement.json',
 'spiders-owned-evidence/progress.json':'spiders-owned-storage/progress.json',
 'spiders-owned-evidence/measurement.json':'spiders-owned-storage/measurement.json',
 'spiders-owned-evidence/exact-lookup-progress.json':'spiders-exact-lookup/progress.json',
 'spiders-owned-evidence/exact-lookup.json':'spiders-exact-lookup/measurement.json',
 'hipparcos-owned-evidence/progress.json':'hipparcos-owned-storage/progress.json',
 'hipparcos-owned-evidence/measurement.json':'hipparcos-owned-storage/measurement.json',
 'exoplanets-owned-evidence/progress.json':'exoplanets-owned-storage/progress.json',
 'exoplanets-owned-evidence/measurement.json':'exoplanets-owned-storage/measurement.json',
 'exoplanets-owned-evidence/exact-lookup-progress.json':'exoplanets-exact-lookup/progress.json',
 'exoplanets-owned-evidence/exact-lookup.json':'exoplanets-exact-lookup/measurement.json',
 'hipparcos-owned-evidence/exact-lookup-progress.json':'hipparcos-exact-lookup/progress.json',
 'hipparcos-owned-evidence/exact-lookup.json':'hipparcos-exact-lookup/measurement.json',
 'allwise-remote-evidence/worker-progress.json':'allwise-full/progress.json',
 'allwise-remote-evidence/packed-full-progress.json':'allwise-packed-full/progress.json',
 'allwise-remote-evidence/packed-full-workspace.json':'allwise-packed-full/workspace.json',
 'allwise-remote-evidence/packed-full-measurement.json':'allwise-packed-full/measurement.json',
}
for table in ['6dfgs.dat','spectra.dat']:
 for artifact in ['expanded.receipt.json','fields.receipt.json','table/progress.json','table/measurement.json','lookup/progress.json','lookup/measurement.json']:
  paths['6df-owned-evidence/'+table+'/'+artifact]='6df-owned-storage/'+table+'/'+artifact
files={target:json.loads((root/source).read_text()) for target,source in paths.items() if (root/source).exists()}
print(json.dumps({'allwise_receipts':receipts,'files':files}))
'''


def collect(host, remote_root, local_root):
    if host.startswith('-'):raise ValueError('invalid SSH host')
    command='python3 -c '+shlex.quote(REMOTE)+' '+shlex.quote(remote_root)
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,command],check=True,capture_output=True,text=True)
    payload=json.loads(result.stdout);rows=payload['allwise_receipts']
    paths=set()
    for name,r in rows.items():
        if Path(name).name!=name or not r['all_fields_verified'] or r['path'] in paths:
            raise ValueError('invalid or duplicate receipt')
        paths.add(r['path'])
        target=local_root/'allwise-remote-evidence/receipts'/name
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists() and json.loads(target.read_text())!=r:raise ValueError('completed receipt changed')
        if not target.exists():save(target,r)
    summary={'status':'INCOMPLETE','observed_unix':time.time(),'files':len(rows),
             'rows':sum(r['rows'] for r in rows.values()),'source_bytes':sum(r['source_bytes'] for r in rows.values()),
             'candidate_detail_bytes':sum(r['detail_bytes'] for r in rows.values()),
             'retained_projection_bytes':sum(r['build_projection']['bytes'] for r in rows.values()),
             'expected_files':12288,'expected_rows':747634026,'full_serving_bytes':None}
    save(local_root/'allwise-remote-evidence/summary.json',summary)
    for name,r in payload['files'].items():
        target=local_root/name
        target.parent.mkdir(parents=True,exist_ok=True);save(target,r)
    print(json.dumps(summary))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('host');p.add_argument('remote_root');p.add_argument('local_root',type=Path)
    a=p.parse_args();collect(a.host,a.remote_root,a.local_root)
