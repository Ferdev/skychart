#!/usr/bin/env python3
"""Reconcile the pinned 70-file acquisition batch, not the full catalog universe."""
import argparse
import json
from pathlib import Path
from measure_gaia_full_partitions import sha,save

DIRECTORIES={'abell':'abell','2mrs':'2mrs','2qz':'2qz','3c':'radio','4c':'radio',
 'fornax-cluster':'fornax','markarian':'markarian','local-volume':'local-volume',
 'clusters':'clusters','nebulae':'nebulae','bass-dr2':'bass'}
DOCUMENTS={'abell--docu.txt','markarian--descrip.doc','clusters--sources.txt'}


def read(path):return json.loads(path.read_text())


def validate_binding(source,audit,data,lookup,expanded=None):
    expected=source['sha256']
    if expanded:
        if expanded['source_sha256']!=expected:raise ValueError('expansion source mismatch')
        expected=expanded['sha256']
    if audit['source_sha256']!=expected:raise ValueError('field audit source mismatch')
    if audit['status']!='SOURCE_FIELDS_AUDITED':raise ValueError('field audit incomplete')
    if any(r['rows']!=source['rows'] for r in [audit,data,lookup]):raise ValueError('row accounting mismatch')
    if data['columns']!=audit['columns'] or not data['all_fields_verified']:raise ValueError('field accounting mismatch')
    if lookup.get('status') not in ['FULL_EXACT_FIELD_LOOKUP_MEASURED','FULL_RECORDS_AND_NAME_ANGULAR_COMPONENT_MEASURED']:
        raise ValueError('lookup not completed')
    if lookup['status']=='FULL_EXACT_FIELD_LOOKUP_MEASURED' and not lookup['all_locators_verified']:
        raise ValueError('lookup verification missing')


def reconcile(base,manifest_path):
    manifest=read(manifest_path);ids=[r['id'] for r in manifest['files']]
    if len(ids)!=len(set(ids)):raise ValueError('duplicate manifest file ID')
    rows=[]
    for spec in manifest['files']:
        name=spec['id'];family,table=name.split('--',1)
        source=read(base/'additional-sources'/(name+'.json'));raw=base/'additional-sources'/(name+'.source')
        if source['status']!='full_source_measured' or source['catalog']!=spec['catalog'] or source['rows']!=spec['rows']:
            raise ValueError('acquired source contract mismatch: '+name)
        if raw.stat().st_size!=source['source_bytes'] or sha(raw)!=source['sha256']:raise ValueError('acquired source changed: '+name)
        row={'id':name,'catalog':spec['catalog'],'rows':source['rows'],'source_bytes':source['source_bytes'],
             'source_sha256':source['sha256'],'source_allocated_bytes':source['allocated_bytes']}
        if name in DOCUMENTS:
            row.update(kind='retained_document',detail_bytes=None,index_bytes=None)
        else:
            expanded=None
            if family=='6df':
                root=base/'6df-owned-evidence'/table
                audit=read(root/'fields.receipt.json');expanded=read(root/'expanded.receipt.json')
                data=read(root/'table/measurement.json');lookup=read(root/'lookup/measurement.json')
            elif family=='nvss':
                root=base/'nvss-owned-evidence'
                audit=read(root/'fields.receipt.json');data=read(root/'detail.receipt.json');lookup=read(root/'measurement.json')
            else:
                root=base/(DIRECTORIES[family]+'-owned-storage')/name
                audit=read(root/'fields.receipt.json');data=read(root/'table/measurement.json');lookup=read(root/'lookup/measurement.json')
                if (root/'expanded.receipt.json').exists():expanded=read(root/'expanded.receipt.json')
            validate_binding(source,audit,data,lookup,expanded)
            if audit['readme_sha256']!=spec['schema_sha256']:raise ValueError('pinned schema mismatch: '+name)
            index_bytes=lookup['index_bytes'] if family=='nvss' else lookup['bytes']
            index_sha=lookup['index_sha256'] if family=='nvss' else lookup['sha256']
            row.update(kind='structured_table',columns=data['columns'],detail_bytes=data['bytes'],
                       detail_sha256=data['sha256'],index_bytes=index_bytes,index_sha256=index_sha,
                       evidence_directory=str(root.relative_to(base)))
        rows.append(row)
    return {'status':'PINNED_ACQUISITION_BATCH_COMPONENTS_RECONCILED','manifest_sha256':sha(manifest_path),
        'files':len(rows),'structured_tables':sum(r['kind']=='structured_table' for r in rows),
        'documents':sum(r['kind']=='retained_document' for r in rows),
        'source_bytes':sum(r['source_bytes'] for r in rows),
        'structured_detail_bytes':sum(r['detail_bytes'] or 0 for r in rows),
        'built_index_bytes':sum(r['index_bytes'] or 0 for r in rows),
        'artifact_verification':'Owned data/index hashes and full checks taken from completed receipts; local acquired source files freshly rehashed.',
        'full_catalog_universe_bytes':None,'full_serving_bytes':None,
        'remaining':['other registry releases','native angular/physical rendering','relationship and identity artifacts',
                     'source-specific extra products','build workspace and retention accounting','native API budgets'],
        'entries':rows}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['root','manifest','output']:p.add_argument(name,type=Path)
    a=p.parse_args();result=reconcile(a.root,a.manifest);save(a.output,result)
    print(json.dumps({k:v for k,v in result.items() if k!='entries'}))
