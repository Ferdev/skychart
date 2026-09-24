#!/usr/bin/env python3
"""Resume pinned full 6dF catalogue and spectrum-metadata measurements."""
import argparse
import gzip
import json
import os
from pathlib import Path
from audit_cds_fixed_width import audit
from measure_cds_table_storage import measure as data_measure
from measure_fits_exact_lookup import measure as lookup_measure
from measure_gaia_full_partitions import guard,save,sha


def expand(source,output,receipt):
    if sha(source)!=receipt['sha256']:raise ValueError('compressed source changed')
    part=output.with_suffix('.partial');count=0
    with gzip.open(source,'rb') as reader,part.open('wb') as writer:
        while chunk:=reader.read(1<<20):
            guard(output.parent,100<<30);writer.write(chunk);count+=len(chunk)
        writer.flush();os.fsync(writer.fileno())
    if count!=receipt['uncompressed_bytes']:raise ValueError('expanded size mismatch')
    part.replace(output)
    return {'source_sha256':receipt['sha256'],'bytes':count,'sha256':sha(output),'gzip_crc_verified':True}


def run(base):
    for table,fields in [('6dfgs.dat',['6dFGS','Target']),('spectra.dat',['SpecID','Target','6dFGS'])]:
        name='6df--'+table;compressed=base/'additional-sources'/(name+'.source')
        receipt=json.loads((base/'additional-sources'/(name+'.json')).read_text())
        if receipt['status']!='full_source_measured':raise ValueError('complete source required')
        readme=base/'extra-catalog-docs/6df';root=base/'6df-owned-storage'/table;root.mkdir(parents=True,exist_ok=True)
        owner=root/'OWNER';marker='SkyChart isolated 6dF measurement 1271\n'
        if owner.exists():
            if owner.read_text()!=marker:raise ValueError('unowned output')
        else:
            if any(root.iterdir()):raise ValueError('nonempty unowned output')
            owner.write_text(marker)
        source=root/'source.dat';expanded=root/'expanded.receipt.json'
        if not expanded.exists():save(expanded,expand(compressed,source,receipt))
        unpacked=json.loads(expanded.read_text())
        if sha(compressed)!=receipt['sha256'] or sha(source)!=unpacked['sha256']:raise ValueError('source checksum changed')
        audited=root/'fields.receipt.json'
        if not audited.exists():save(audited,audit(source,readme,table,receipt['rows'],unpacked['sha256'],pad_short_records=True))
        print(json.dumps({'table':table,'data':data_measure(source,readme,audited,root/'table'),
                          'lookup':lookup_measure(root/'table',root/'lookup',fields)}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();run(a.root)
