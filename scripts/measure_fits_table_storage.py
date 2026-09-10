#!/usr/bin/env python3
"""Measure every supported decoded FITS table field, preserving fixed arrays.

Source numeric null sentinels and NaNs remain unchanged; FITS headers retain
units, TNULL and dimensional metadata. This is table data, not serving indexes.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import time
import fitsio
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from measure_gaia_full_partitions import guard,save,sha


def arrow_table(batch,metadata):
    columns=[]
    for name in batch.dtype.names:
        values=batch[name]
        if values.dtype.kind not in 'biufSU':
            raise ValueError(f'unsupported FITS field dtype: {name}: {values.dtype}')
        native=values.astype(values.dtype.newbyteorder('='),copy=False)
        array=pa.array(native.reshape(-1),from_pandas=False)
        for size in reversed(values.shape[1:]):array=pa.FixedSizeListArray.from_arrays(array,size)
        columns.append(array)
    return pa.Table.from_arrays(columns,names=batch.dtype.names).replace_schema_metadata(metadata)


def verify_batch(batch,table):
    if list(batch.dtype.names)!=table.column_names or len(batch)!=table.num_rows:
        raise ValueError('stored field/row accounting mismatch')
    for name in batch.dtype.names:
        original=batch[name];array=table[name].combine_chunks();shape=[len(array)]
        while pa.types.is_fixed_size_list(array.type):
            shape.append(array.type.list_size);array=array.flatten()
        restored=array.to_numpy(zero_copy_only=False).reshape(shape)
        if original.shape!=restored.shape or not np.array_equal(original,restored,equal_nan=original.dtype.kind=='f'):
            raise ValueError('stored scientific field differs: '+name)


def measure(source,audit_path,output,batch_rows=1024):
    if batch_rows<1:raise ValueError('invalid batch size')
    audited=json.loads(audit_path.read_text())
    if audited['status']!='COMPLETE_SOURCE_READ' or sha(source)!=audited['source_sha256']:
        raise ValueError('complete source audit and unchanged source required')
    output.mkdir(parents=True,exist_ok=True)
    lock=(output/'.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker='SkyChart isolated FITS table storage 1271\n';owner=output/'OWNER'
    if owner.exists():
        if owner.read_text()!=marker:raise ValueError('unowned output')
    else:
        if any(p.name!='.lock' for p in output.iterdir()):raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin={'source_sha256':audited['source_sha256'],'source_audit_sha256':sha(audit_path),
         'format':'fits-native-numeric-fixed-arrays-zstd3-v1','batch_rows':batch_rows,
         'fitsio_version':fitsio.__version__,'numpy_version':np.__version__,'pyarrow_version':pa.__version__}
    if (output/'manifest.json').exists() and json.loads((output/'manifest.json').read_text())!=pin:
        raise ValueError('source or storage contract changed')
    save(output/'manifest.json',pin);started=time.monotonic();receipts=[];excluded=[]
    with fitsio.FITS(source) as hdus:
        if len(hdus)!=len(audited['hdus']):raise ValueError('HDU count changed')
        for index,hdu in enumerate(hdus):
            evidence=audited['hdus'][index]
            if 'rows_read' not in evidence:
                excluded.append({'hdu':index,'scope':'non-table content remains only in retained source','info':evidence['info']});continue
            count=evidence['rows_read'];name=f'hdu-{index:03d}.parquet';path=output/name;receipt_path=path.with_suffix('.receipt.json')
            if hdu.get_nrows()!=count:raise ValueError('source table row count changed')
            if receipt_path.exists():
                receipt=json.loads(receipt_path.read_text())
                if sha(path)!=receipt['sha256']:raise ValueError('completed table changed')
            else:
                tick=time.monotonic();part=path.with_suffix('.partial');rows=0
                metadata={b'source_sha256':audited['source_sha256'].encode(),b'fits_header':str(hdu.read_header()).encode(),
                          b'semantics':b'All decoded field values, fixed-array dimensions, numeric null sentinels and NaNs retained. No coordinate or distance inference.'}
                save(output/'progress.json',{'status':'CONVERTING_TABLE','hdu':index,'rows':0,'expected_rows':count})
                # Obtain the exact schema even for a zero-row table.
                first=hdu[0:min(batch_rows,count)];schema=arrow_table(first,metadata).schema
                with pq.ParquetWriter(part,schema,compression='zstd',compression_level=3,use_dictionary=False) as writer:
                    for start in range(0,count,batch_rows):
                        guard(output,100<<30);batch=hdu[start:min(start+batch_rows,count)]
                        table=arrow_table(batch,metadata)
                        if not table.schema.equals(schema,check_metadata=True):raise ValueError('field type/shape drift')
                        writer.write_table(table,row_group_size=batch_rows);rows+=len(batch)
                        if start//batch_rows%64==0:save(output/'progress.json',{'status':'CONVERTING_TABLE','hdu':index,'rows':rows,'expected_rows':count})
                if rows!=count:raise ValueError('conversion count mismatch')
                stored=pq.ParquetFile(part);offset=0
                save(output/'progress.json',{'status':'VERIFYING_ALL_TABLE_FIELDS','hdu':index,'expected_rows':count})
                for group in range(stored.num_row_groups):
                    table=stored.read_row_group(group,use_threads=False)
                    verify_batch(hdu[offset:offset+table.num_rows],table);offset+=table.num_rows
                if offset!=count:raise ValueError('verification count mismatch')
                with part.open('rb') as f:os.fsync(f.fileno())
                part.replace(path)
                receipt={'hdu':index,'file':name,'rows':count,'columns':evidence['fields'],'all_fields_verified':True,
                         'bytes':path.stat().st_size,'allocated_bytes':path.stat().st_blocks*512,'sha256':sha(path),
                         'seconds':time.monotonic()-tick}
                save(receipt_path,receipt)
            receipts.append(receipt)
    result={'status':'FULL_FITS_TABLE_DATA_COMPONENT_MEASURED','source_sha256':audited['source_sha256'],
            'tables':receipts,'detail_bytes':sum(r['bytes'] for r in receipts),
            'detail_allocated_bytes':sum(r['allocated_bytes'] for r in receipts),
            'non_table_content_excluded':excluded,'seconds_current_invocation':time.monotonic()-started,
            'full_serving_bytes':None,'remaining':['source-record and alias routing','angular/physical indexes and rendering','cross-identification evidence','native APIs and performance budgets']}
    save(output/'measurement.json',result);save(output/'progress.json',{'status':result['status']});return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('audit',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    print(json.dumps(measure(a.source,a.audit,a.output)))
