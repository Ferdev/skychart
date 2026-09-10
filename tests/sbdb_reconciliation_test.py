import json
from pathlib import Path
import sqlite3
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from reconcile_sbdb_categories import insert_category, compare


def test_cross_category_duplicates_rollback_and_version_changes(tmp_path):
    source=tmp_path/'source.json';fields=['spkid','kind','orbit_id']
    db=sqlite3.connect(':memory:')
    db.execute('CREATE TABLE census(spkid INTEGER PRIMARY KEY,kind TEXT,orbit_id TEXT)')
    source.write_text(json.dumps({'data':[[str(2**53+1),'an','42']]}))
    with db:assert insert_category(db,source,fields,'an')==1
    source.write_text(json.dumps({'data':[['2','au','1'],[str(2**53+1),'au','42']]}))
    with pytest.raises(sqlite3.IntegrityError):
        with db:insert_category(db,source,fields,'au')
    assert db.execute('SELECT count(*) FROM census').fetchone()[0]==1
    source.write_text(json.dumps({'data':[[str(2**53+1),'an','42']]}))
    assert compare(db,source)['differing_ids_or_orbits']==0
    source.write_text(json.dumps({'data':[[str(2**53+1),'an','43'],['7','cu',None]]}))
    assert compare(db,source)['differing_ids_or_orbits']==2
