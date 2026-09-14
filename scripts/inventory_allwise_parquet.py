#!/usr/bin/env python3
"""Bounded anonymous provider-metadata inventory; downloads no catalog data files.

Reported object sizes are not local allocated bytes or SkyChart index sizes.
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE='https://irsa.ipac.caltech.edu/data/download/parquet/wise/allwise/healpix_k5/'
PREFIX='wise/allwise/catalogs/p3as_psd/healpix_k5/wise-allwise.parquet/'


def bounded(url):
    with urllib.request.urlopen(url,timeout=30) as response:
        data=response.read(2*1024**2+1)
        if len(data)>2*1024**2:raise ValueError('metadata response exceeds 2 MiB cap')
        return data


def inventory(output):
    output.mkdir(parents=True,exist_ok=False)
    params={'list-type':'2','prefix':PREFIX,'max-keys':'1000'}
    objects=[];pages=0;start=time.monotonic()
    ns={'s':'http://s3.amazonaws.com/doc/2006-03-01/'}
    while True:
        body=bounded('https://nasa-irsa-wise.s3.us-west-2.amazonaws.com/?'+urllib.parse.urlencode(params))
        root=ET.fromstring(body)
        for obj in root.findall('s:Contents',ns):
            objects.append({'key':obj.findtext('s:Key',namespaces=ns),
                            'bytes':int(obj.findtext('s:Size',namespaces=ns)),
                            'etag':obj.findtext('s:ETag',namespaces=ns)})
        pages+=1
        if root.findtext('s:IsTruncated',namespaces=ns)!='true':break
        if pages>=15:raise ValueError('15-page metadata budget reached')
        params['continuation-token']=root.findtext('s:NextContinuationToken',namespaces=ns)
    row_data=bounded(BASE+'wise-allwise-row-counts-per-file.csv')
    rows=list(csv.DictReader(io.StringIO(row_data.decode())))
    files={x['key'].split('healpix_k5/',1)[1]:x for x in objects if x['key'].endswith('.parquet')}
    if set(files)!={x['path'] for x in rows}:raise ValueError('object inventory and row manifest disagree')
    object_data=(json.dumps(objects,sort_keys=True)+'\n').encode()
    (output/'objects.json').write_bytes(object_data)
    (output/'rows.csv').write_bytes(row_data)
    result={'scope':'provider-reported remote metadata; catalog contents not downloaded/verified',
            'files':len(files),'rows_reported':sum(int(x['nrows']) for x in rows),
            'data_logical_bytes_reported':sum(x['bytes'] for x in files.values()),
            'all_objects_bytes_reported':sum(x['bytes'] for x in objects),
            'object_inventory_sha256':hashlib.sha256(object_data).hexdigest(),
            'row_manifest_sha256':hashlib.sha256(row_data).hexdigest(),
            'pages':pages,'elapsed_seconds':time.monotonic()-start}
    (output/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path)
    a=p.parse_args();print(json.dumps(inventory(a.output),indent=2))
