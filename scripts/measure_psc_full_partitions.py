#!/usr/bin/env python3
"""Measure complete PSC gzip files with all 60 fields and release accounting.

Owned detail temporaries are recycled only after a verified durable receipt.
Retained projections are build workspace, not final serving indexes or tiles.
"""
import argparse
import fcntl
import json
from pathlib import Path
import re
import resource
import time
import urllib.request
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as csv
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard, save, sha

FORMAT='2mass-psc-all60-f64-zstd3-v1'
SUMS=('pts_key','pxcntr','scan_key','scan','ext_key','coadd_key','coadd','mp_flg',
      'gal_contam','use_src','dup_src','nopt_mchs','phi_opt','dist_edge_ew','dist_edge_ns','err_ang')
EXPECTED=(306810325437475788,306815556538478936,16902776758555,32666066948,
          2048692118201,388758631396659,64617139213,16048,729878,464456155,
          79798372,369187043,64916239773,69388217174,2670725813652,29279563815)
BUILD=('pts_key','ra','decl','designation','j_m','h_m','k_m','ph_qual','rd_flg','bl_flg','cc_flg','ext_key')


def progress(receipts,root):
    all_rows=[json.loads(r.read_text()) for r in receipts.glob('*.json')]
    total_rows=sum(r['rows'] for r in all_rows)
    totals={k:sum(r['integer_verification_sums'][k] for r in all_rows) for k in SUMS}
    if len(all_rows)==92:
        if total_rows!=470992970 or tuple(totals[k] for k in SUMS)!=EXPECTED:
            raise ValueError('PSC full release verification sums failed')
    save(root/'progress.json',{'status':'COMPLETE_DETAIL_COMPONENT' if len(all_rows)==92 else 'INCOMPLETE',
          'files':len(all_rows),'expected_files':92,'rows':total_rows,'integer_verification_sums':totals,
          'measured_detail_bytes':sum(r['detail_bytes'] for r in all_rows),'full_serving_bytes':None})


def schema_from(path):
    fields=re.findall(r'^\s+(\w+) (double precision|real|smallint|integer|date|character\(\d+\))[,\n]',path.read_text(),re.M)
    if len(fields)!=60:raise ValueError('PSC schema must have 60 fields')
    return pa.schema([(name,pa.float64() if kind in ('real','double precision') else
                       pa.int16() if kind=='smallint' else pa.int32() if kind=='integer' else pa.string())
                      for name,kind in fields],metadata={b'format':FORMAT.encode(),b'original_schema':path.read_bytes()})


def reader(source,schema):
    return csv.open_csv(source,read_options=csv.ReadOptions(column_names=schema.names,use_threads=False,block_size=1<<20),
                        parse_options=csv.ParseOptions(delimiter='|',quote_char=False),
                        convert_options=csv.ConvertOptions(column_types={f.name:f.type for f in schema},
                            null_values=['\\N'],strings_can_be_null=True))


def measure(source,schema_path,output,projection,root,floor):
    start=time.monotonic();schema=schema_from(schema_path);rows=0;sums={k:0 for k in SUMS}
    proj_schema=pa.schema([schema.field(k) for k in BUILD],metadata={b'purpose':b'build workspace, not complete source records',b'photometry':b'2MASS J/H/K; not optical magnitude'})
    with pq.ParquetWriter(output,schema,compression='zstd',compression_level=3) as writer, \
         pq.ParquetWriter(projection,proj_schema,compression='zstd',compression_level=3,
                          use_dictionary=['ph_qual','rd_flg','bl_flg','cc_flg']) as project:
        for batch in reader(source,schema):
            table=pa.Table.from_batches([batch]).replace_schema_metadata(schema.metadata)
            writer.write_table(table,row_group_size=4096)
            project.write_table(table.select(BUILD).replace_schema_metadata(proj_schema.metadata),row_group_size=4096)
            rows+=len(table)
            for key in SUMS:sums[key]+=pc.sum(table[key]).as_py() or 0
            guard(root,floor)
    detail=pq.ParquetFile(output);project=pq.ParquetFile(projection);group=0;checked=0
    for batch in reader(source,schema):
        table=pa.Table.from_batches([batch]).replace_schema_metadata(schema.metadata)
        for offset in range(0,len(table),4096):
            expected=table.slice(offset,4096)
            if not expected.equals(detail.read_row_group(group)):raise ValueError('PSC detail lost source fields')
            if not expected.select(BUILD).replace_schema_metadata(proj_schema.metadata).equals(project.read_row_group(group)):
                raise ValueError('PSC build projection lost fields')
            group+=1;checked+=len(expected)
        guard(root,floor)
    if rows!=checked or detail.metadata.num_rows!=rows or project.metadata.num_rows!=rows:raise ValueError('PSC row accounting mismatch')
    return {'format':FORMAT,'rows':rows,'columns':60,'integer_verification_sums':sums,
            'source_bytes':source.stat().st_size,'source_sha256':sha(source),
            'detail_bytes':output.stat().st_size,'detail_allocated_bytes':output.stat().st_blocks*512,'detail_sha256':sha(output),
            'build_projection':{'file':projection.name,'bytes':projection.stat().st_size,'allocated_bytes':projection.stat().st_blocks*512,'sha256':sha(projection),'columns':list(BUILD),'scope':'workspace only'},
            'all_fields_verified':True,'full_gzip_crc_verified':True,'seconds':time.monotonic()-start,
            'peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'global_serving_artifacts':'UNBUILT'}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True)
    p.add_argument('--manifest',type=Path,required=True);p.add_argument('--schema',type=Path,required=True)
    p.add_argument('--existing-source',type=Path);p.add_argument('--max-files',type=int,default=1)
    a=p.parse_args();a.root.mkdir(parents=True,exist_ok=True)
    lock=(a.root/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker=a.root/'OWNER';owner='SkyChart exhaustive PSC investigation 1271\n'
    if marker.exists():
        if marker.read_text()!=owner:raise ValueError('PSC workspace ownership mismatch')
    else:
        if any(p.name!='.lock' for p in a.root.iterdir()):raise ValueError('refuse unowned nonempty PSC workspace')
        marker.write_text(owner)
    pinned=a.root/'manifest.json';manifest=json.loads(a.manifest.read_text())
    if len(manifest['files'])!=92:raise ValueError('full PSC manifest must contain 92 files')
    names=[entry['file'] for entry in manifest['files']]
    if len(set(names))!=92 or any(not re.fullmatch(r'psc_[ab][a-z]{2}\.gz',name) for name in names):
        raise ValueError('invalid or duplicate PSC source filenames')
    if pinned.exists() and json.loads(pinned.read_text())!=manifest:raise ValueError('PSC manifest changed')
    if not pinned.exists():save(pinned,manifest)
    schema=a.root/'schema.sql'
    if schema.exists() and schema.read_bytes()!=a.schema.read_bytes():raise ValueError('PSC schema changed')
    if not schema.exists():schema.write_bytes(a.schema.read_bytes())
    receipts=a.root/'receipts';receipts.mkdir(exist_ok=True);projections=a.root/'build-projections';projections.mkdir(exist_ok=True)
    count=0
    for entry in manifest['files']:
        name=entry['file'];receipt=receipts/(name+'.json')
        if receipt.exists():
            old=json.loads(receipt.read_text())
            if old['format']!=FORMAT or not old['all_fields_verified']:raise ValueError('invalid PSC receipt')
            project=projections/old['build_projection']['file']
            if not project.exists() or project.stat().st_size!=old['build_projection']['bytes']:
                raise ValueError('PSC retained build input missing or changed')
            continue
        if a.max_files and count>=a.max_files:break
        source=a.root/'download.gz';owned=True;guard(a.root,100*(1<<30))
        if a.existing_source and a.existing_source.name==name:source=a.existing_source;owned=False
        else:
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(entry['url'],timeout=120) as r,source.open('wb') as f:
                        size=0
                        while b:=r.read(1<<20):
                            size+=len(b)
                            if size>entry['provider_reported_bytes']:raise ValueError('PSC source size changed')
                            f.write(b);guard(a.root,100*(1<<30))
                    if size!=entry['provider_reported_bytes']:raise ValueError('truncated PSC source')
                    break
                except (OSError,ValueError):
                    if attempt==3:raise
                    time.sleep(5*(attempt+1))
        if source.stat().st_size!=entry['provider_reported_bytes']:raise ValueError('PSC source size mismatch')
        output=a.root/'detail.parquet'
        result=measure(source,schema,output,projections/(name+'.parquet'),a.root,100*(1<<30))
        result.update(source_file=name,source_url=entry['url']);save(receipt,result)
        output.unlink()
        if owned:source.unlink()
        progress(receipts,a.root)
        count+=1;print(json.dumps({'file':name,'rows':result['rows'],'detail_bytes':result['detail_bytes'],'seconds':result['seconds']}),flush=True)
    progress(receipts,a.root)

if __name__=='__main__':main()
