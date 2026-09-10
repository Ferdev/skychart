#!/usr/bin/env python3
"""Bounded, resumable full-field FITS conversion in investigation-owned storage.

Each source row belongs to exactly one pinned output partition. A partition is
accepted only after every stored field has been compared with a second source
read. These data files do not constitute a serving index or rendering release.
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

from measure_fits_table_storage import arrow_table, verify_batch
from measure_gaia_full_partitions import guard, save, sha


def measure(source, audit_path, output, partition_rows=100_000, batch_rows=1024,
            max_new_partitions=None):
    if partition_rows < 1 or batch_rows < 1 or (max_new_partitions is not None and max_new_partitions < 0):
        raise ValueError('invalid partition limits')
    audited = json.loads(audit_path.read_text())
    if audited['status'] != 'COMPLETE_SOURCE_READ' or sha(source) != audited['source_sha256']:
        raise ValueError('complete source audit and unchanged source required')
    output.mkdir(parents=True, exist_ok=True)
    lock = (output / '.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    marker = 'SkyChart isolated partitioned FITS storage 1271\n'
    owner = output / 'OWNER'
    if owner.exists():
        if owner.read_text() != marker:
            raise ValueError('unowned output')
    else:
        if any(p.name != '.lock' for p in output.iterdir()):
            raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    pin = {'source_sha256': audited['source_sha256'], 'audit_sha256': sha(audit_path),
           'format': 'fits-partitioned-native-fields-zstd3-v1',
           'partition_rows': partition_rows, 'batch_rows': batch_rows,
           'fitsio': fitsio.__version__, 'numpy': np.__version__, 'pyarrow': pa.__version__}
    manifest = output / 'manifest.json'
    if manifest.exists() and json.loads(manifest.read_text()) != pin:
        raise ValueError('source or partition contract changed')
    save(manifest, pin)
    started = time.monotonic()
    receipts, excluded = [], []
    new = 0
    expected_rows = sum(h.get('rows_read', 0) for h in audited['hdus'])

    def result(complete):
        value = {'status': 'FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED' if complete else 'INCOMPLETE_PARTITIONED_FITS_DATA',
                 'source_sha256': pin['source_sha256'], 'partitions': receipts,
                 'rows': sum(r['rows'] for r in receipts), 'expected_rows': expected_rows,
                 'detail_bytes': sum(r['bytes'] for r in receipts),
                 'detail_allocated_bytes': sum(r['allocated_bytes'] for r in receipts),
                 'non_table_content_excluded': excluded,
                 'seconds_current_invocation': time.monotonic() - started,
                 'full_serving_bytes': None,
                 'remaining': ['global ID/alias/angular routing', 'cross-identification evidence',
                               'native rendering, API integration and budgets']}
        if complete:
            if value['rows'] != expected_rows:
                raise ValueError('full row accounting mismatch')
            final = output / 'measurement.json'
            if final.exists():
                previous = json.loads(final.read_text())
                stable = lambda r: {k: v for k, v in r.items() if k != 'seconds_current_invocation'}
                if stable(previous) != stable(value):
                    raise ValueError('completed measurement changed')
                value = previous
            else:
                save(final, value)
        save(output / 'progress.json', value)
        return value

    with fitsio.FITS(source) as hdus:
        if len(hdus) != len(audited['hdus']):
            raise ValueError('HDU count changed')
        for index, hdu in enumerate(hdus):
            evidence = audited['hdus'][index]
            if 'rows_read' not in evidence:
                excluded.append({'hdu': index, 'scope': 'retained original source only', 'info': evidence['info']})
                continue
            count = evidence['rows_read']
            if hdu.get_nrows() != count or len(hdu.get_colnames()) != evidence['fields']:
                raise ValueError('source table shape changed')
            for start in range(0, max(1, count), partition_rows):
                stop = min(start + partition_rows, count)
                name = f'hdu-{index:03d}-rows-{start:012d}-{stop:012d}.parquet'
                path = output / name
                receipt_path = path.with_suffix('.receipt.json')
                identity = {'hdu': index, 'source_start': start, 'source_stop': stop,
                            'rows': stop-start, 'columns': evidence['fields'], 'file': name}
                if receipt_path.exists():
                    receipt = json.loads(receipt_path.read_text())
                    if any(receipt.get(k) != v for k, v in identity.items()) or not receipt.get('all_fields_verified'):
                        raise ValueError('partition receipt accounting changed')
                    if sha(path) != receipt['sha256'] or path.stat().st_size != receipt['bytes']:
                        raise ValueError('completed partition changed')
                else:
                    if max_new_partitions is not None and new >= max_new_partitions:
                        return result(False)
                    tick = time.monotonic()
                    partial = path.with_suffix('.partial')
                    metadata = {b'source_sha256': pin['source_sha256'].encode(),
                                b'fits_header': str(hdu.read_header()).encode(),
                                b'source_partition': json.dumps(identity, sort_keys=True).encode(),
                                b'semantics': b'Original decoded fields, arrays, numeric null sentinels and NaNs. No position inference.'}
                    schema = arrow_table(hdu[start:min(start+batch_rows, stop)], metadata).schema
                    written = 0
                    with pq.ParquetWriter(partial, schema, compression='zstd', compression_level=3, use_dictionary=False) as writer:
                        for offset in range(start, stop, batch_rows):
                            guard(output, 100 << 30)
                            table = arrow_table(hdu[offset:min(offset+batch_rows, stop)], metadata)
                            if not table.schema.equals(schema, check_metadata=True):
                                raise ValueError('field type/shape drift')
                            writer.write_table(table, row_group_size=batch_rows)
                            written += table.num_rows
                    if written != stop-start:
                        raise ValueError('partition row accounting mismatch')
                    stored = pq.ParquetFile(partial)
                    # Parquet normalizes synthetic list-child names from item
                    # to element. Compare scientific types/shapes separately
                    # from our source header and provenance metadata.
                    if not stored.schema_arrow.equals(schema) or stored.schema_arrow.metadata != schema.metadata:
                        raise ValueError('stored schema or metadata differs')
                    offset = start
                    for group in range(stored.num_row_groups):
                        table = stored.read_row_group(group, use_threads=False)
                        verify_batch(hdu[offset:offset+table.num_rows], table)
                        offset += table.num_rows
                    if offset != stop:
                        raise ValueError('verification row accounting mismatch')
                    stored.close()
                    with partial.open('rb') as stream:
                        os.fsync(stream.fileno())
                    partial.replace(path)
                    receipt = {**identity, 'all_fields_verified': True, 'bytes': path.stat().st_size,
                               'allocated_bytes': path.stat().st_blocks*512, 'sha256': sha(path),
                               'seconds': time.monotonic()-tick}
                    save(receipt_path, receipt)
                    new += 1
                receipts.append(receipt)
                result(False)
    return result(True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('audit', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--partition-rows', type=int, default=100_000)
    p.add_argument('--batch-rows', type=int, default=1024)
    p.add_argument('--max-new-partitions', type=int)
    a = p.parse_args()
    print(json.dumps(measure(a.source, a.audit, a.output, a.partition_rows, a.batch_rows, a.max_new_partitions)))
