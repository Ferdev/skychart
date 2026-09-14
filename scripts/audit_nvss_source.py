#!/usr/bin/env python3
"""Read all NVSS CDS fields, including one-byte signs and limit flags.

The published gzip has variable-length records with omitted trailing blanks.
Pad only missing trailing field positions for inspection; retain raw source.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import time
from audit_cds_fixed_width import schema,INTEGER,NUMBER
from acquire_catalog_source_manifest import save


def audit(source,readme,receipt):
    if receipt['catalog']!='VIII/65' or receipt['rows']!=1773484:raise ValueError('wrong full-release contract')
    with source.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    if digest!=receipt['sha256']:raise ValueError('compressed source changed')
    fields=schema(readme,'nvss.dat')
    if len(fields)!=29 or not {'DE-','l_MajAxis','l_MinAxis'}<={f['name'] for f in fields}:raise ValueError('incomplete scientific schema')
    width=max(f['end'] for f in fields);rows=raw_bytes=0;lengths=Counter();blanks=Counter();invalid=Counter();examples=[]
    flags={name:Counter() for name in ['DE-','l_MajAxis','l_MinAxis','f_resFlux']};started=time.monotonic()
    with gzip.open(source,'rb') as stream:
        for line in stream:
            raw_bytes+=len(line);raw=line.rstrip(b'\r\n');lengths[len(raw)]+=1;rows+=1
            if len(raw)>width:raise ValueError('record exceeds pinned schema')
            raw=raw.ljust(width,b' ')
            for field in fields:
                name=field['name'];value=raw[field['start']-1:field['end']].strip()
                if not value:blanks[name]+=1
                elif field['format'][0]!='A':
                    pattern=INTEGER if field['format'][0]=='I' else NUMBER
                    if not pattern.fullmatch(value):
                        invalid[name]+=1
                        if len(examples)<20:examples.append({'row':rows,'field':name,'raw':value.decode('ascii',errors='backslashreplace')})
                if name in flags:
                    text=value.decode('ascii')
                    if text not in flags[name] and len(flags[name])>=100:raise ValueError('unexpected flag cardinality')
                    flags[name][text]+=1
    if rows!=receipt['rows'] or raw_bytes!=receipt['uncompressed_bytes']:raise ValueError('full source accounting mismatch')
    return {'status':'SOURCE_FIELDS_AUDITED' if not invalid else 'INCOMPLETE_NUMERIC_SCHEMA_EXCEPTIONS',
            'rows':rows,'columns':len(fields),'schema':fields,'source_bytes':source.stat().st_size,
            'source_sha256':digest,'uncompressed_bytes':raw_bytes,'record_length_counts':dict(lengths),
            'trailing_blank_normalization':'Pad missing trailing positions to declared width only; raw compressed source retained unchanged',
            'blank_counts':dict(blanks),'invalid_numeric_counts':dict(invalid),'invalid_examples':examples,
            'flags':{k:dict(v) for k,v in flags.items()},'readme_sha256':hashlib.sha256(readme.read_bytes()).hexdigest(),
            'seconds':time.monotonic()-started,'normalized_bytes':None,'full_serving_bytes':None,
            'remaining':['full stored detail','unique name/routing/angular indexes','cross-identification evidence','native rendering and API budgets']}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args()
    root=a.root;receipt=json.loads((root/'source.receipt.json').read_text())
    result=audit(root/'source.gz',root/'ReadMe',receipt);save(root/'fields.receipt.json',result)
    print(json.dumps({k:v for k,v in result.items() if k not in {'schema','flags','blank_counts'}}))
