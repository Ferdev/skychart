#!/usr/bin/env python3
"""Audit every field of a pinned CDS fixed-width source without changing it.

Blank numeric fields remain unknown; raw source and schema hashes preserve
all precision, units, flags and provenance. This does not build serving data.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import time

INTEGER=re.compile(rb'[+-]?[0-9]+\Z')
NUMBER=re.compile(rb'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[EeDd][+-]?[0-9]+)?\Z')


def schema(readme, table):
    marker='Byte-by-byte Description of file: '+table
    text=readme.read_text()
    if text.count(marker)!=1:raise ValueError('table schema ambiguous or missing')
    section=text.split(marker,1)[1].split('Byte-by-byte Description of file:',1)[0]
    fields=[]
    for line in section.splitlines():
        match=re.match(r'^\s*(\d+)(?:\s*-\s*(\d+))?\s+([AIFED]\d+(?:\.\d+)?)\s+(\S+)\s+(\S+)\s+(.*)',line)
        if match:
            start,end,fmt,unit,name,description=match.groups()
            field={'start':int(start),'end':int(end or start),'format':fmt,'unit':unit,'name':name,'description':description}
            if name=='---':field.update(name='_unnamed_byte_'+start,source_name=name)
            fields.append(field)
    if not fields or len({f['name'] for f in fields})!=len(fields):raise ValueError('invalid field definitions')
    prior=0
    for f in fields:
        if f['start']<=prior or f['end']<f['start']:raise ValueError('overlapping fields')
        prior=f['end']
    return fields


def audit(source, readme, table, expected_rows, expected_sha256, record_width=None, pad_short_records=False):
    started=time.monotonic();fields=schema(readme,table);width=max(f['end'] for f in fields)
    source_width=width if record_width is None else record_width
    if source_width<width:raise ValueError('record width truncates defined fields')
    blanks=Counter();invalid=Counter();examples=[];rows=0;digest=hashlib.sha256();lengths=Counter()
    # Low-cardinality scientifically significant flags/bands only. Avoid
    # accumulating millions of unique object names in memory.
    distributions={n:Counter() for n in ['V','l_max','u_max','n_max','f_min','l_min','u_min','n_min','u_Epoch','l_Period','u_Period'] if n in {f['name'] for f in fields}}
    with source.open('rb') as stream:
        for line in stream:
            digest.update(line);record=line.rstrip(b'\r\n');rows+=1
            lengths[len(record)]+=1
            if pad_short_records and record and len(record)<source_width:record=record.ljust(source_width,b' ')
            if len(record)!=source_width:raise ValueError(f'row {rows}: width {len(record)} != {source_width}')
            if record[width:].strip(b' '):raise ValueError(f'row {rows}: nonblank undocumented trailing bytes')
            for f in fields:
                name=f['name'];value=record[f['start']-1:f['end']].strip()
                if not value:blanks[name]+=1
                elif f['format'][0]!='A':
                    pattern=INTEGER if f['format'][0]=='I' else NUMBER
                    if not pattern.fullmatch(value):
                        invalid[name]+=1
                        if len(examples)<20:examples.append({'row':rows,'field':name,'raw':value.decode('ascii',errors='backslashreplace')})
                if name in distributions:
                    text=value.decode('ascii')
                    if text not in distributions[name] and len(distributions[name])>=1000:
                        raise ValueError('unexpected flag/band cardinality')
                    distributions[name][text]+=1
    if rows!=expected_rows:raise ValueError('source row accounting mismatch')
    if digest.hexdigest()!=expected_sha256:raise ValueError('source checksum mismatch')
    return {'status':'SOURCE_FIELDS_AUDITED' if not invalid else 'INCOMPLETE_NUMERIC_SCHEMA_EXCEPTIONS',
            'rows':rows,'columns':len(fields),'record_width':source_width,'schema':fields,
            'last_field_byte':width,'trailing_blank_bytes_validated':source_width-width,
            'pad_short_records':pad_short_records,'source_record_lengths':dict(lengths),
            'blank_counts':dict(blanks),'invalid_numeric_counts':dict(invalid),'invalid_examples':examples,
            'flag_and_band_counts':{k:dict(v) for k,v in distributions.items()},
            'source_sha256':digest.hexdigest(),'readme_sha256':hashlib.sha256(readme.read_bytes()).hexdigest(),
            'source_bytes':source.stat().st_size,'allocated_bytes':source.stat().st_blocks*512,
            'seconds':time.monotonic()-started,'normalized_bytes':None,'full_serving_bytes':None,
            'remaining':['unique identifiers and associations','coordinate validity','normalized storage','native serving artifacts']}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path);p.add_argument('readme',type=Path);p.add_argument('table')
    p.add_argument('rows',type=int);p.add_argument('sha256');p.add_argument('receipt',type=Path)
    p.add_argument('--record-width',type=int,help='Documented record width; bytes after the last field must be spaces')
    p.add_argument('--pad-short-records',action='store_true',help='Explicitly interpret omitted trailing CDS positions as blanks; retain original source lengths')
    a=p.parse_args();result=audit(a.source,a.readme,a.table,a.rows,a.sha256,a.record_width,a.pad_short_records)
    part=a.receipt.with_suffix('.json.tmp');part.write_text(json.dumps(result,indent=2)+'\n');part.replace(a.receipt)
    print(json.dumps({k:v for k,v in result.items() if k not in {'schema','flag_and_band_counts'}}))
