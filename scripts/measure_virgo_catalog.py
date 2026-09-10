#!/usr/bin/env python3
"""Measure pinned complete VCC data and names without asserting cluster membership."""
import argparse
import json
from pathlib import Path
from measure_6df_catalog import expand
from audit_cds_fixed_width import audit
from measure_cds_table_storage import measure as data_measure
from measure_fits_exact_lookup import measure as lookup_measure
from measure_gaia_full_partitions import save,sha


def run(base):
    source=base/'virgo-source/virgo-vcc--vcc.dat.source'
    receipt=json.loads((base/'virgo-source/virgo-vcc--vcc.dat.json').read_text())
    if receipt['status']!='full_source_measured' or receipt['rows']!=2096:raise ValueError('full VCC source required')
    root=base/'virgo-owned-storage';root.mkdir(parents=True,exist_ok=True)
    expanded=root/'expanded.receipt.json';plain=root/'source.dat'
    if not expanded.exists():save(expanded,expand(source,plain,receipt))
    r=json.loads(expanded.read_text())
    if sha(source)!=receipt['sha256'] or sha(plain)!=r['sha256']:raise ValueError('source changed')
    readme=base/'access-followup/virgo-readme-resolved';audited=root/'fields.receipt.json'
    if not audited.exists():save(audited,audit(plain,readme,'vcc.dat',2096,r['sha256'],pad_short_records=True))
    return {'data':data_measure(plain,readme,audited,root/'table'),
            'lookup':lookup_measure(root/'table',root/'lookup',['VCC','ID'])}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();print(json.dumps(run(a.root)))
