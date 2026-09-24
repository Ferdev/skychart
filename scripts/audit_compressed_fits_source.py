#!/usr/bin/env python3
"""Audit an acquired complete gzip/FITS source in isolated owned workspace.

Compressed bytes, decompressed bytes and full table reads are separate receipts.
Only an interrupted, uncommitted decompression file may be replaced on resume.
"""
import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
from acquire_catalog_source_manifest import save
from audit_fits_source import audit


def digest(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def unpack(source,output,expected_sha,min_free_bytes=100<<30):
    if digest(source)!=expected_sha:raise ValueError('compressed source checksum mismatch')
    part=output.with_suffix('.partial');h=hashlib.sha256();count=0;started=time.monotonic()
    try:
        with gzip.open(source,'rb') as reader,part.open('wb') as writer:
            while block:=reader.read(1<<20):
                if shutil.disk_usage(output.parent).free<min_free_bytes+(1<<20):raise RuntimeError('live-workload headroom guard reached')
                writer.write(block);h.update(block);count+=len(block)
            writer.flush();os.fsync(writer.fileno())
        # Reading through EOF validates each gzip member's CRC and length.
        if count==0 or count%2880:raise ValueError('uncompressed file is not complete FITS blocks')
        part.replace(output)
    except (OSError,ValueError):
        # Keep the uncommitted file as evidence; never replace valid output.
        raise
    return {'status':'GZIP_CRC_AND_DECOMPRESSED_BYTES_VERIFIED','compressed_sha256':expected_sha,
            'compressed_bytes':source.stat().st_size,'decompressed_bytes':count,
            'decompressed_allocated_bytes':output.stat().st_blocks*512,'decompressed_sha256':h.hexdigest(),
            'seconds':time.monotonic()-started,'table_rows':None}


def run(source_root,output):
    source=source_root/'source.bin';receipt=json.loads((source_root/'receipt.json').read_text())
    if receipt['status']!='FULL_SOURCE_BYTES_ONLY' or source.stat().st_size!=receipt['bytes']:
        raise ValueError('complete acquired source required')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated compressed FITS source audit 1271\n';owner=output/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'source_sha256':receipt['sha256'],'source_url':receipt['url']}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:
        raise ValueError('source release changed')
    save(output/'manifest.json',pin)
    path=output/'source.fits';unpacked=output/'decompressed.receipt.json'
    if unpacked.exists():
        expanded=json.loads(unpacked.read_text())
        if digest(source)!=receipt['sha256'] or digest(path)!=expanded['decompressed_sha256']:
            raise ValueError('completed source bytes changed')
    else:
        save(output/'progress.json',{'status':'DECOMPRESSING_AND_VALIDATING_GZIP'})
        expanded=unpack(source,path,receipt['sha256']);save(unpacked,expanded)
    result_path=output/'fits-audit.json'
    if result_path.exists():return json.loads(result_path.read_text())
    save(output/'progress.json',{'status':'AUDITING_ALL_FITS_TABLE_FIELDS'})
    result=audit(path,expanded['decompressed_sha256'])
    result.update(compressed_source_bytes=receipt['bytes'],compressed_source_sha256=receipt['sha256'])
    save(result_path,result)
    save(output/'progress.json',{'status':result['status'],'tables':[{'rows':h['rows_read'],'fields':h['fields']} for h in result['hdus'] if 'rows_read' in h]})
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_root',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    result=run(a.source_root,a.output);print(json.dumps({k:v for k,v in result.items() if k!='hdus'}))
