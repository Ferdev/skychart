#!/usr/bin/env python3
"""Measure the full pinned Green 2024 summary table; detailed notes remain separate."""
import argparse
import json
from pathlib import Path
from audit_cds_fixed_width import audit
from measure_cds_table_storage import measure as data_measure
from measure_fits_exact_lookup import measure as lookup_measure
from measure_gaia_full_partitions import save,sha


def run(base):
    source=base/'snr-source/supernova-remnants--snrs.dat.source'
    receipt=json.loads((base/'snr-source/supernova-remnants--snrs.dat.json').read_text())
    if receipt['status']!='full_source_measured' or receipt['rows']!=310 or sha(source)!=receipt['sha256']:raise ValueError('full unchanged summary source required')
    readme=base/'access-followup/snr-readme';root=base/'snr-owned-storage';root.mkdir(parents=True,exist_ok=True)
    audited=root/'fields.receipt.json'
    if not audited.exists():save(audited,audit(source,readme,'snrs.dat',310,receipt['sha256'],pad_short_records=True))
    return {'data':data_measure(source,readme,audited,root/'table'),
            'lookup':lookup_measure(root/'table',root/'lookup',['SNR','Names'])}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();print(json.dumps(run(a.root)))
