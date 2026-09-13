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
starts=[int(value) for value in sys.argv[2:5]]

def load_receipts(directory,start):
 paths=sorted(directory.glob('*.json'))
 if [int(path.stem) for path in paths] != list(range(len(paths))):
  raise ValueError('remote receipt sequence is not contiguous')
 if not 0 <= start <= len(paths):
  raise ValueError('local receipt checkpoint exceeds remote receipt count')
 rows=[json.loads(path.read_text()) for path in paths]
 return rows,{path.name:row for path,row in zip(paths[start:],rows[start:])}

assert (root/'allwise-full/OWNER').read_text()=='SkyChart isolated full AllWISE measurement 1271\n'
allwise_rows,receipts=load_receipts(root/'allwise-full/receipts',starts[0])
assert len({row['path'] for row in allwise_rows})==len(allwise_rows)
allwise_totals={'files':len(allwise_rows),'rows':sum(row['rows'] for row in allwise_rows),
 'source_bytes':sum(row['source_bytes'] for row in allwise_rows),
 'candidate_detail_bytes':sum(row['detail_bytes'] for row in allwise_rows),
 'retained_projection_bytes':sum(row['build_projection']['bytes'] for row in allwise_rows)}
reject_root=root/'allwise-reject-full'
reject_receipts={}
reject_rows=[]
if reject_root.exists():
 assert (reject_root/'OWNER').read_text()=='SkyChart isolated allwise-reject measurement 1271\n'
 reject_rows,reject_receipts=load_receipts(reject_root/'receipts',starts[1])
 assert len({row['source_file'] for row in reject_rows})==len(reject_rows)
reject_totals={'files':len(reject_rows),'rows':sum(row['rows'] for row in reject_rows),
 'source_bytes':sum(row['source_bytes'] for row in reject_rows),
 'uncompressed_bytes':sum(row['uncompressed_bytes'] for row in reject_rows),
 'candidate_detail_bytes':sum(row['detail_bytes'] for row in reject_rows),
 'candidate_projection_bytes':sum(row['build_projection']['bytes'] for row in reject_rows)}
mep_root=root/'allwise-mep-full'
mep_receipts={}
mep_rows=[]
if mep_root.exists():
 assert (mep_root/'OWNER').read_text()=='SkyChart isolated allwise-mep measurement 1271\n'
 mep_rows,mep_receipts=load_receipts(mep_root/'receipts',starts[2])
 assert len({row['source_file'] for row in mep_rows})==len(mep_rows)
mep_totals={'files':len(mep_rows),'rows':sum(row['rows'] for row in mep_rows),
 'source_bytes':sum(row['source_bytes'] for row in mep_rows),
 'uncompressed_bytes':sum(row['uncompressed_bytes'] for row in mep_rows),
 'candidate_detail_bytes':sum(row['detail_bytes'] for row in mep_rows),
 'candidate_projection_bytes':sum(row['build_projection']['bytes'] for row in mep_rows)}
paths={
 'psc-remote-evidence/full-build-progress.json':'psc-full/lookup.progress.json',
 'psc-remote-evidence/full-build-measurement.json':'psc-full/lookup.receipt.json',
 'psc-remote-evidence/full-query-benchmark.json':'psc-full/full-query-benchmark.json',
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
 'allwise-images-provider-evidence/s3-progress.json':'allwise-images-s3-inventory/progress.json',
 'allwise-images-provider-evidence/s3-inventory.json':'allwise-images-s3-inventory/inventory.receipt.json',
 'allwise-images-provider-evidence/product-bytes.json':'allwise-images-s3-inventory/product-bytes.receipt.json',
 'allwise-images-provider-evidence/polar-progress.json':'allwise-polar-provider-inventory/progress.json',
 'allwise-images-provider-evidence/polar-inventory.json':'allwise-polar-provider-inventory/inventory.receipt.json',
 'allwise-reject-evidence/progress.json':'allwise-reject-full/progress.json',
 'allwise-reject-evidence/first-receipt.json':'allwise-reject-full/receipts/0000.json',
 'allwise-reject-evidence/feasibility.json':'allwise-reject-full/feasibility.json',
 'allwise-reject-evidence/workspace-observed-peak-full-continuation.json':'allwise-reject-full/workspace-observed-peak-full-continuation.json',
 'allwise-mep-evidence/progress.json':'allwise-mep-full/progress.json',
 'allwise-mep-evidence/first-receipt.json':'allwise-mep-full/receipts/0000.json',
 'allwise-mep-evidence/feasibility.json':'allwise-mep-full/feasibility.json',
 'allwise-mep-evidence/workspace-observed-peak.json':'allwise-mep-full/workspace-observed-peak.json',
 'allwise-mep-evidence/workspace-observed-peak-full-continuation.json':'allwise-mep-full/workspace-observed-peak-full-continuation.json',
}
for table in ['6dfgs.dat','spectra.dat']:
 for artifact in ['expanded.receipt.json','fields.receipt.json','table/progress.json','table/measurement.json','lookup/progress.json','lookup/measurement.json']:
  paths['6df-owned-evidence/'+table+'/'+artifact]='6df-owned-storage/'+table+'/'+artifact
files={target:json.loads((root/source).read_text()) for target,source in paths.items() if (root/source).exists()}
print(json.dumps({'allwise_receipts':receipts,'allwise_totals':allwise_totals,
 'allwise_reject_receipts':reject_receipts,'allwise_reject_totals':reject_totals,
 'allwise_mep_receipts':mep_receipts,'allwise_mep_totals':mep_totals,'files':files}))
'''


def continuous_receipt_count(directory):
    files=sorted(directory.glob('*.json')) if directory.exists() else []
    if [int(path.stem) for path in files] != list(range(len(files))):
        raise ValueError(f'local receipt sequence is not contiguous: {directory}')
    return len(files)


def collect(host, remote_root, local_root):
    if host.startswith('-'):raise ValueError('invalid SSH host')
    destinations=[local_root/'allwise-remote-evidence/receipts',
                  local_root/'allwise-reject-evidence/receipts',
                  local_root/'allwise-mep-evidence/receipts']
    starts=[continuous_receipt_count(path) for path in destinations]
    command=('python3 -c '+shlex.quote(REMOTE)+' '+shlex.quote(remote_root)+' '+
             ' '.join(str(value) for value in starts))
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
    totals=payload['allwise_totals']
    if continuous_receipt_count(destinations[0])!=totals['files']:
        raise ValueError('incremental AllWISE receipt collection is incomplete')
    summary={'status':'INCOMPLETE','observed_unix':time.time(),**totals,
             'expected_files':12288,'expected_rows':747634026,'full_serving_bytes':None}
    save(local_root/'allwise-remote-evidence/summary.json',summary)
    reject_rows=payload['allwise_reject_receipts']
    reject_sources=set()
    for name,r in reject_rows.items():
        if (Path(name).name!=name or not r['all_fields_verified'] or
                not r['full_bzip_crc_verified'] or r['source_file'] in reject_sources):
            raise ValueError('invalid or duplicate AllWISE Reject receipt')
        reject_sources.add(r['source_file'])
        target=local_root/'allwise-reject-evidence/receipts'/name
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists() and json.loads(target.read_text())!=r:
            raise ValueError('completed AllWISE Reject receipt changed')
        if not target.exists():save(target,r)
    reject_totals=payload['allwise_reject_totals']
    if continuous_receipt_count(destinations[1])!=reject_totals['files']:
        raise ValueError('incremental AllWISE Reject receipt collection is incomplete')
    if reject_totals['files']==48 and reject_totals['rows']!=428787253:
        raise ValueError('complete AllWISE Reject receipts do not reconcile provider rows')
    reject_summary={
        'status':'FULL_CANDIDATE_COMPONENT_MEASURED' if reject_totals['files']==48 else 'INCOMPLETE',
        'observed_unix':time.time(),**reject_totals,'expected_files':48,
        'expected_rows':428787253,
        'full_serving_bytes':None,
    }
    save(local_root/'allwise-reject-evidence/summary.json',reject_summary)
    mep_rows=payload['allwise_mep_receipts']
    mep_sources=set()
    for name,r in mep_rows.items():
        if (Path(name).name!=name or not r['all_fields_verified'] or
                not r['full_bzip_crc_verified'] or r['source_file'] in mep_sources):
            raise ValueError('invalid or duplicate AllWISE MEP receipt')
        mep_sources.add(r['source_file'])
        target=local_root/'allwise-mep-evidence/receipts'/name
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists() and json.loads(target.read_text())!=r:
            raise ValueError('completed AllWISE MEP receipt changed')
        if not target.exists():save(target,r)
    mep_totals=payload['allwise_mep_totals']
    if continuous_receipt_count(destinations[2])!=mep_totals['files']:
        raise ValueError('incremental AllWISE MEP receipt collection is incomplete')
    if mep_totals['files']==792 and mep_totals['rows']!=42759337365:
        raise ValueError('complete AllWISE MEP receipts do not reconcile provider rows')
    mep_summary={
        'status':'FULL_CANDIDATE_COMPONENT_MEASURED' if mep_totals['files']==792 else 'INCOMPLETE',
        'observed_unix':time.time(),**mep_totals,'expected_files':792,
        'expected_rows':42759337365,
        'full_serving_bytes':None,
    }
    save(local_root/'allwise-mep-evidence/summary.json',mep_summary)
    for name,r in payload['files'].items():
        target=local_root/name
        target.parent.mkdir(parents=True,exist_ok=True);save(target,r)
    print(json.dumps(summary))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('host');p.add_argument('remote_root');p.add_argument('local_root',type=Path)
    a=p.parse_args();collect(a.host,a.remote_root,a.local_root)
