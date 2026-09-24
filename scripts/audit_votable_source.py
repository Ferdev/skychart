#!/usr/bin/env python3
"""Audit a complete TABLEDATA export, retaining source schema and null counts.

Reject overflow, query errors, multiple tables and unsupported encodings.
No numeric coercion, scientific cuts, identity merges or database writes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def audit(path, expected_rows):
    fields=[]; nulls={}; rows=0; stack=[]; tables=0; statuses=[]; names=None
    for event, element in ET.iterparse(path, events=('start','end')):
        tag=element.tag.rsplit('}',1)[-1]
        if event=='start':
            stack.append(element)
            if tag=='TABLE':
                tables+=1
                if tables!=1:raise ValueError('expected a single table')
            if tag in {'BINARY','BINARY2','FITS'}:raise ValueError('unsupported VOTable encoding')
        else:
            if tag=='INFO' and element.get('name')=='QUERY_STATUS':
                statuses.append(element.get('value'))
                if element.get('value')!='OK':raise ValueError('archive QUERY_STATUS: '+str(element.get('value')))
            if tag=='FIELD':
                fields.append({'attributes':dict(element.attrib),'definition_xml':ET.tostring(element,encoding='unicode')})
            if tag=='TR':
                if names is None:
                    names=[f['attributes']['name'] for f in fields]
                    if not names or len(names)!=len(set(names)):raise ValueError('missing or duplicate source fields')
                    nulls=dict.fromkeys(names,0)
                values=[cell.text for cell in element]
                if len(values)!=len(names):raise ValueError('row field count differs from schema')
                for key,value in zip(names,values):nulls[key]+=value is None or value==''
                rows+=1
                stack[-2].remove(element)
            stack.pop()
    if tables!=1 or not statuses or rows!=expected_rows:raise ValueError('incomplete table or row count mismatch')
    with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    return {'status':'complete_TABLEDATA_source_audited','rows':rows,'columns':len(fields),
            'fields':fields,'empty_cell_counts':nulls,'query_statuses':statuses,
            'source_bytes':path.stat().st_size,'allocated_bytes':path.stat().st_blocks*512,
            'sha256':digest,'normalized_bytes':None,'full_serving_bytes':None}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path)
    p.add_argument('expected_rows',type=int);p.add_argument('receipt',type=Path);a=p.parse_args()
    result=audit(a.source,a.expected_rows)
    a.receipt.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in {'fields','empty_cell_counts'}}))
