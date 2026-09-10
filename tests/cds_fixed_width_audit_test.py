import hashlib
from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from audit_cds_fixed_width import audit


def test_blanks_zero_flags_and_invalid_measurements(tmp_path):
    readme=tmp_path/'ReadMe';source=tmp_path/'values.dat'
    readme.write_text('Byte-by-byte Description of file: values.dat\n 1- 2 I2 --- OID Identifier\n 4- 7 F4.1 mag max ? Maximum\n 9- 9 A1 --- l_max Limit\n')
    source.write_bytes(b' 1      >\n 2  0.0  \n 3 nope <\n')
    r=audit(source,readme,'values.dat',3,hashlib.sha256(source.read_bytes()).hexdigest())
    assert r['blank_counts']['max']==1
    assert r['invalid_numeric_counts']=={'max':1}
    assert r['flag_and_band_counts']['l_max']=={'>':1,'':1,'<':1}
    assert r['full_serving_bytes'] is None
    source.write_bytes(b' 1 0\n')
    with pytest.raises(ValueError,match='width'):audit(source,readme,'values.dat',1,hashlib.sha256(source.read_bytes()).hexdigest())


def test_single_byte_declination_sign_and_limit_flags(tmp_path):
    from audit_cds_fixed_width import schema
    readme=tmp_path/'ReadMe';source=tmp_path/'values.dat'
    readme.write_text('Byte-by-byte Description of file: values.dat\n 1- 2 I2 deg DEd Degrees\n 3 A1 --- DE- Declination sign\n 4 A1 --- l_max Limit flag\n')
    source.write_bytes(b'12-<\n00+ \n')
    fields=schema(readme,'values.dat')
    assert [(f['name'],f['start'],f['end']) for f in fields]==[('DEd',1,2),('DE-',3,3),('l_max',4,4)]
    result=audit(source,readme,'values.dat',2,hashlib.sha256(source.read_bytes()).hexdigest())
    assert result['columns']==3
    assert result['flag_and_band_counts']['l_max']=={'<':1,'':1}


def test_explicit_trailing_blank_width_never_discards_content(tmp_path):
    readme=tmp_path/'ReadMe';source=tmp_path/'values.dat'
    readme.write_text('Byte-by-byte Description of file: values.dat\n 1 I1 --- ID Identifier\n')
    source.write_bytes(b'1 \n')
    digest=lambda:hashlib.sha256(source.read_bytes()).hexdigest()
    with pytest.raises(ValueError,match='width'):audit(source,readme,'values.dat',1,digest())
    result=audit(source,readme,'values.dat',1,digest(),record_width=2)
    assert result['trailing_blank_bytes_validated']==1 and result['last_field_byte']==1
    source.write_bytes(b'1X\n')
    with pytest.raises(ValueError,match='nonblank'):audit(source,readme,'values.dat',1,digest(),record_width=2)
    with pytest.raises(ValueError,match='truncates'):audit(source,readme,'values.dat',1,digest(),record_width=0)


def test_short_record_padding_is_explicit_and_source_hash_stays_original(tmp_path):
    readme=tmp_path/'ReadMe';source=tmp_path/'values.dat'
    readme.write_text('Byte-by-byte Description of file: values.dat\n 1 I1 --- ID Identifier\n 3-8 A6 --- Notes Notes\n')
    source.write_bytes(b'1\n2 note\n');digest=hashlib.sha256(source.read_bytes()).hexdigest()
    with pytest.raises(ValueError,match='width'):audit(source,readme,'values.dat',2,digest)
    result=audit(source,readme,'values.dat',2,digest,pad_short_records=True)
    assert result['source_sha256']==digest and result['source_record_lengths']=={1:1,6:1}
    assert result['blank_counts']['Notes']==1
    source.write_bytes(b'\n')
    with pytest.raises(ValueError,match='width'):
        audit(source,readme,'values.dat',1,hashlib.sha256(source.read_bytes()).hexdigest(),pad_short_records=True)
