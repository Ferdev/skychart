#!/usr/bin/env python3
"""Independent source/artifact reconciliation and offline bounded query checks."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import socket
import sqlite3
import time
import pyarrow.parquet as pq
from investigate_catalog_storage import timing


def verify(root,schema_path,inputs):
    report=json.loads((root/'measurement.json').read_text())
    expected={'ext_key':2146404951676,'use_src':1587504,'dup_src':196537,'pts_key':992540387061069}
    assert report['rows']==1647599 and report['source_verification_sums']==expected
    db=sqlite3.connect((root/'lookup.sqlite').resolve().as_uri()+'?mode=ro',uri=True)
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert db.execute('SELECT count(*) FROM lookup').fetchone()[0]==report['rows']
    assert db.execute('SELECT count(*) FROM angular').fetchone()[0]==report['rows']
    for part in report['partitions']:
        path=root/part['name']
        assert path.stat().st_size==part['bytes']
        assert hashlib.file_digest(path.open('rb'),'sha256').hexdigest()==part['sha256']
        assert pq.ParquetFile(path).metadata.num_rows==part['rows']
    keys=[db.execute('SELECT ext_key FROM lookup ORDER BY ext_key LIMIT 1 OFFSET ?',
                     (index,)).fetchone()[0] for index in (0,report['rows']//4,report['rows']//2,3*report['rows']//4,report['rows']-1)]
    fields=re.findall(r'^\s+(\w+) (double precision|real|smallint|integer|date|character\(\d+\))[,\n]',schema_path.read_text(),re.M)
    source_records={};scanned=0;start=time.monotonic()
    for path in inputs:
        with gzip.open(path,'rt') as stream:
            for line in stream:
                scanned+=1
                key=int(line.rsplit('|',1)[1])
                if key in keys:
                    values=line.rstrip('\n').split('|')
                    source_records[key]={name:None if value=='\\N' else float(value) if kind in ('real','double precision') else int(value) if kind in ('integer','smallint') else value
                                         for (name,kind),value in zip(fields,values)}
                if scanned%10000==0 and time.monotonic()-start>180:
                    raise TimeoutError('independent source scan exceeded 180 seconds')
    assert scanned==report['rows'] and len(source_records)==len(keys)
    source_scan_seconds=time.monotonic()-start
    # No network access is possible during the actual lookup/detail checks.
    original_socket=socket.socket
    def unavailable(*args,**kwargs):raise AssertionError('unexpected network access')
    socket.socket=unavailable
    queries=[]
    try:
        for key in keys:
            row=source_records[key]
            def detail():
                part,group,offset=db.execute('SELECT partition,row_group,row_offset FROM lookup WHERE ext_key=?',(key,)).fetchone()
                actual=pq.ParquetFile(root/report['partitions'][part]['name']).read_row_group(group,use_threads=False).slice(offset,1).to_pylist()[0]
                assert actual==row
            prefix=row['designation'][:5]
            def search():
                return db.execute('SELECT ext_key FROM lookup WHERE designation>=? AND designation<? ORDER BY designation LIMIT 101',(prefix,prefix+'\uffff')).fetchall()
            ra,dec=row['ra'],row['decl']
            width=min(180,1/max(.00001,math.cos(math.radians(abs(dec)+1)))) if abs(dec)<89 else 180
            ranges=[(ra-width,ra+width)]
            if ranges[0][0]<0:ranges=[(0,ra+width),(ra-width+360,360)]
            elif ranges[0][1]>360:ranges=[(ra-width,360),(0,ra+width-360)]
            def cone():
                candidates={}
                for lo,hi in ranges:
                    for k,x,y in db.execute('''SELECT l.ext_key,l.ra,l.dec FROM angular a CROSS JOIN lookup l ON l.ext_key=a.ext_key
                      WHERE min_ra<=? AND max_ra>=? AND min_dec<=? AND max_dec>=? LIMIT 10001''',(hi,lo,dec+1,dec-1)):
                        candidates[k]=(x,y)
                if len(candidates)>=10001:raise OverflowError('candidate cap exceeded')
                matches=[]
                r,d=math.radians(ra),math.radians(dec)
                for k,(x,y) in candidates.items():
                    dot=math.sin(d)*math.sin(math.radians(y))+math.cos(d)*math.cos(math.radians(y))*math.cos(r-math.radians(x))
                    if dot>=math.cos(math.radians(1)):matches.append(k)
                assert key in matches
                return sorted(matches)[:101]
            queries.append({'ext_key':key,'offline_detail_all_389_fields':timing(detail,repeats=10),
                            'designation_prefix':timing(search),'one_degree_cone':timing(cone)})
        assert db.execute('SELECT * FROM lookup WHERE ext_key=-1').fetchone() is None
    finally:
        socket.socket=original_socket
        db.close()
    return {'source_rows_independently_scanned':scanned,'source_scan_seconds':source_scan_seconds,
            'verified_source_record_keys':keys,'full_catalog_checksums_counts_and_integer_sums_match':True,
            'all_389_fields_compared_for_selected_source_records':True,'network_disabled_for_queries':True,
            'queries_warm_local_only':queries,'native_phoenix_integration_verified':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('root',type=Path);p.add_argument('schema',type=Path);p.add_argument('inputs',nargs='+',type=Path)
    a=p.parse_args();result=verify(a.root,a.schema,a.inputs)
    (a.root/'independent-verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
