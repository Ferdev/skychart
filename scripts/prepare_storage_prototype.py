#!/usr/bin/env python3
"""Prepare a bounded, original-row provenance-layout fixture for a local audit.

Does not connect to any database. Output is exclusive-created, never overwritten.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path


def prepare(snapshot, output):
    if snapshot.stat().st_size>128*1024**2:
        raise ValueError('bounded snapshot required')
    rows=json.loads(snapshot.read_text())['stars']
    if len(rows)>100_000:
        raise ValueError('at most 100000 original rows')
    with output.open('x') as stream:
        writer=csv.writer(stream,delimiter='\t',lineterminator='\n')
        for row in rows:
            ns=['ESA','gaiadr3.gaia_source','DR3',row['source_id']]
            key=hashlib.sha256(json.dumps(ns,separators=(',',':')).encode()).hexdigest()
            record=dict(provider=ns[0],catalog=ns[1],release=ns[2],source_id=ns[3],
                        name=row['name'],documentation='https://www.cosmos.esa.int/web/gaia/dr3',
                        astrometry={'ra_deg':row['ra_deg'],'dec_deg':row['dec_deg'],
                                    'frame':'ICRS','source_epoch':2016.0},measurements=row,
                        capabilities={'searchable_metadata':True,'angular_position':True,
                                      'spatial_position':False,'dynamic_ephemeris':False})
            writer.writerow([key,*ns,json.dumps(record,separators=(',',':'),allow_nan=False)])
    return len(rows)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    print(json.dumps({'rows':prepare(args.snapshot,args.output)}))
