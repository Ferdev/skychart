from pathlib import Path
import json
import sys

import fitsio
import numpy as np
import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import measure_fits_partition_storage as module
from audit_fits_source import audit


def fixture(tmp_path, monkeypatch, rows=7):
    monkeypatch.setattr(module, 'guard', lambda *args: None)
    source = tmp_path / 'source.fits'
    batch = np.zeros(rows, dtype=[('id', '>i8'), ('motion', '>f4', (2, 3)),
                                  ('name', 'S12'), ('flag', '?'), ('null_marker', '>i4')])
    if rows:
        batch['id'] = np.arange(rows) + 9007199254740993
        batch['motion'][0, 1, 2] = np.nan
        batch['name'] = b'0001'
        batch['flag'][::2] = True
        batch['null_marker'][0] = -2147483648
    fitsio.write(source, batch, header={'TNULL5': -2147483648}, clobber=True)
    receipt = tmp_path / 'audit.json'
    receipt.write_text(json.dumps(audit(source, module.sha(source), batch_rows=2)))
    return source, receipt, tmp_path / 'output'


def test_partition_resume_full_fields_and_no_rewrite_of_accepted_data(tmp_path, monkeypatch):
    source, audit_path, output = fixture(tmp_path, monkeypatch)
    partial = module.measure(source, audit_path, output, 3, 2, max_new_partitions=1)
    assert partial['status'] == 'INCOMPLETE_PARTITIONED_FITS_DATA'
    assert partial['rows'] == 3 and not (output / 'measurement.json').exists()
    accepted = output / partial['partitions'][0]['file']
    stamp = accepted.stat().st_mtime_ns
    # An interrupted, uncommitted next partition can be safely overwritten.
    (output / 'hdu-001-rows-000000000003-000000000006.partial').write_bytes(b'truncated')
    result = module.measure(source, audit_path, output, 3, 2)
    assert result['status'] == 'FULL_PARTITIONED_FITS_DATA_COMPONENT_MEASURED'
    assert result['rows'] == result['expected_rows'] == 7
    assert result['full_serving_bytes'] is None
    assert accepted.stat().st_mtime_ns == stamp
    assert [(r['source_start'], r['source_stop']) for r in result['partitions']] == [(0, 3), (3, 6), (6, 7)]
    with fitsio.FITS(source) as hdus:
        for r in result['partitions']:
            table = pq.read_table(output / r['file'])
            module.verify_batch(hdus[1][r['source_start']:r['source_stop']], table)
            assert b'TNULL5' in table.schema.metadata[b'fits_header']
    final_bytes = (output / 'measurement.json').read_bytes()
    repeated = module.measure(source, audit_path, output, 3, 2)
    assert (output / 'measurement.json').read_bytes() == final_bytes
    assert repeated['partitions'] == result['partitions']
    assert repeated['detail_bytes'] == sum((output / r['file']).stat().st_size for r in result['partitions'])
    with pytest.raises(ValueError, match='partition contract changed'):
        module.measure(source, audit_path, output, 4, 2)
    accepted.write_bytes(b'corrupt')
    with pytest.raises(ValueError, match='completed partition changed'):
        module.measure(source, audit_path, output, 3, 2)


def test_failed_field_verification_never_admits_partition(tmp_path, monkeypatch):
    source, audit_path, output = fixture(tmp_path, monkeypatch)
    verify = module.verify_batch
    def fail(*args):
        raise ValueError('injected scientific mismatch')
    monkeypatch.setattr(module, 'verify_batch', fail)
    with pytest.raises(ValueError, match='scientific mismatch'):
        module.measure(source, audit_path, output, 3, 2)
    assert not list(output.glob('*.receipt.json'))
    assert not (output / 'measurement.json').exists()
    monkeypatch.setattr(module, 'verify_batch', verify)
    assert module.measure(source, audit_path, output, 3, 2)['rows'] == 7
    with source.open('ab') as stream:
        stream.write(b'truncated alteration')
    with pytest.raises(ValueError, match='unchanged source required'):
        module.measure(source, audit_path, output, 3, 2)


def test_zero_row_table_retains_schema(tmp_path, monkeypatch):
    source, audit_path, output = fixture(tmp_path, monkeypatch, rows=0)
    result = module.measure(source, audit_path, output, 3, 2)
    assert result['rows'] == 0
    assert len(result['partitions']) == 1
    table = pq.read_table(output / result['partitions'][0]['file'])
    assert table.column_names == ['id', 'motion', 'name', 'flag', 'null_marker']
    assert table.num_rows == 0
