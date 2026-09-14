"""Scientific information retention checks for the experimental storage codecs."""
import sys
from pathlib import Path
import pytest

pa=pytest.importorskip('pyarrow',reason='storage investigation uses the existing optional bulk dependencies')

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from investigate_catalog_storage import decode
from recompress_catalog_partitions import equal_values


def test_presence_encoding_distinguishes_absent_null_zero_and_lossless_id():
    fields=['distance','source_id']
    table=pa.Table.from_pylist([
        {'distance':None,'source_id':'18446744073709551615','__present':2},
        {'distance':None,'source_id':'null-distance','__present':3},
        {'distance':0.0,'source_id':'real-zero','__present':3},
    ])
    assert decode(table,fields)==[
        {'source_id':'18446744073709551615'},
        {'distance':None,'source_id':'null-distance'},
        {'distance':0.0,'source_id':'real-zero'},
    ]


def test_recompression_verifier_detects_precision_null_and_schema_loss():
    original=pa.record_batch([pa.array([None,0.0,1.000000000001,float('nan')])],names=['measurement'])
    assert equal_values(original,original)
    assert not equal_values(original,pa.record_batch([pa.array([0.0,0.0,1.000000000001,float('nan')])],names=['measurement']))
    assert not equal_values(original,pa.record_batch([pa.array([None,0.0,1.0,float('nan')])],names=['measurement']))
    assert not equal_values(original,pa.record_batch([pa.array([None,0.0,1.000000000001,float('nan')])],names=['other_units']))
