#!/usr/bin/env python3
"""Read every FITS table field in bounded batches and pin source/schema evidence.

This measures source bytes and decoded row counts, not normalized storage or
serving artifacts. Integer null sentinels and nonfinite values remain distinct.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time

import fitsio
import numpy as np


def audit(source, expected_sha256, batch_rows=1024):
    if batch_rows < 1:
        raise ValueError('batch_rows must be positive')
    started = time.monotonic()
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != expected_sha256:
        raise ValueError('source checksum mismatch')
    size = source.stat().st_size
    if size % 2880:
        raise ValueError('truncated FITS block')
    result = {'status': 'COMPLETE_SOURCE_READ', 'source_sha256': digest,
              'source_bytes': size, 'allocated_bytes': source.stat().st_blocks * 512,
              'fitsio_version': fitsio.__version__, 'hdus': [],
              'normalized_bytes': None, 'full_serving_bytes': None}
    with fitsio.FITS(source) as hdus:
        for hdu in hdus:
            info = hdu.get_info()
            header = hdu.read_header()
            if info['data_end'] > size:
                raise ValueError('HDU exceeds source file')
            item = {'info': info, 'header': str(header)}
            if info['hdutype'] == 2:
                names = hdu.get_colnames()
                if len(names) != len(set(names)):
                    raise ValueError('duplicate column names')
                stats = {name: {'values_read': 0, 'nonfinite_values': 0,
                               'integer_null_sentinels': 0} for name in names}
                rows = 0
                for start in range(0, hdu.get_nrows(), batch_rows):
                    batch = hdu[start:start + batch_rows]
                    if len(batch) != min(batch_rows, hdu.get_nrows() - start):
                        raise ValueError('short table read')
                    rows += len(batch)
                    for index, name in enumerate(names, 1):
                        values = batch[name]
                        stats[name]['values_read'] += values.size
                        if values.dtype.kind in 'fc':
                            stats[name]['nonfinite_values'] += int(np.count_nonzero(~np.isfinite(values)))
                        if values.dtype.kind in 'iu' and 'TNULL' + str(index) in header:
                            stats[name]['integer_null_sentinels'] += int(np.count_nonzero(values == header['TNULL' + str(index)]))
                item.update(rows_read=rows, fields=len(names), field_statistics=stats)
            else:
                # Header/data offsets and the whole-file SHA cover other HDUs;
                # do not materialize potentially giant images just to audit tables.
                item['non_table_data_validation'] = 'byte checksum and extent only'
            result['hdus'].append(item)
    result['seconds'] = time.monotonic() - started
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('expected_sha256')
    parser.add_argument('receipt', type=Path)
    args = parser.parse_args()
    result = audit(args.source, args.expected_sha256)
    temporary = args.receipt.with_suffix('.json.tmp')
    with temporary.open('w') as stream:
        json.dump(result, stream, indent=2); stream.write('\n')
        stream.flush(); os.fsync(stream.fileno())
    temporary.replace(args.receipt)
    print(json.dumps({key: value for key, value in result.items() if key != 'hdus'}))
