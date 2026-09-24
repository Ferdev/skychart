#!/usr/bin/env python3
"""Resume complete pinned 3C, 3CR and 4C data/name component measurements."""
import argparse
import json
from pathlib import Path
from audit_cds_fixed_width import audit
from measure_cds_table_storage import measure as data_measure
from measure_fits_exact_lookup import measure as lookup_measure
from measure_gaia_full_partitions import save
from measure_gaia_full_partitions import sha
from measure_6df_catalog import expand


def measure_tables(base,specifications,output_directory,schema_tables=None,record_widths=None):
    for family,table,fields in specifications:
        name=family+'--'+table;source=base/'additional-sources'/(name+'.source')
        receipt=json.loads((base/'additional-sources'/(name+'.json')).read_text())
        if receipt['status']!='full_source_measured':raise ValueError('complete source required')
        readme=base/'extra-catalog-docs'/family;root=base/output_directory/name
        root.mkdir(parents=True,exist_ok=True);audited=root/'fields.receipt.json'
        expected_sha=receipt['sha256']
        with source.open('rb') as stream:compressed=stream.read(2)==b'\x1f\x8b'
        if compressed:
            expanded=root/'expanded.receipt.json';unpacked=root/'source.dat'
            if not expanded.exists():save(expanded,expand(source,unpacked,receipt))
            evidence=json.loads(expanded.read_text())
            if sha(source)!=receipt['sha256'] or sha(unpacked)!=evidence['sha256']:raise ValueError('expanded source changed')
            source=unpacked;expected_sha=evidence['sha256']
        schema_table=(schema_tables or {}).get(table,table)
        if not audited.exists():save(audited,audit(source,readme,schema_table,receipt['rows'],expected_sha,
                                                  record_width=(record_widths or {}).get(table),pad_short_records=True))
        # Each measurement rechecks the pinned source/schema or data checksum.
        print(json.dumps({'table':name,'data':data_measure(source,readme,audited,root/'table'),
                          'lookup':lookup_measure(root/'table',root/'lookup',fields)}),flush=True)


def run(base):
    measure_tables(base,[('3c','3c.dat',['3C']),('3c','3cr.dat',['3CR']),('4c','radio4c.dat',['4C'])],'radio-owned-storage')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();run(a.root)
