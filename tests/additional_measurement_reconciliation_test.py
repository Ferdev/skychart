from pathlib import Path
import sys,copy
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from reconcile_additional_measurements import validate_binding


def test_receipts_must_bind_exact_source_rows_fields_and_verified_lookup():
    source={'sha256':'compressed','rows':7}
    audit={'source_sha256':'expanded','rows':7,'columns':3,'status':'SOURCE_FIELDS_AUDITED'}
    data={'rows':7,'columns':3,'all_fields_verified':True}
    lookup={'rows':7,'status':'FULL_EXACT_FIELD_LOOKUP_MEASURED','all_locators_verified':True}
    expanded={'source_sha256':'compressed','sha256':'expanded'}
    validate_binding(source,audit,data,lookup,expanded)
    for target,field,value in [(audit,'source_sha256','wrong'),(data,'rows',6),(data,'columns',2),
                                (lookup,'all_locators_verified',False),(expanded,'source_sha256','wrong')]:
        old=target[field];target[field]=value
        with pytest.raises(ValueError):validate_binding(source,audit,data,lookup,expanded)
        target[field]=old
