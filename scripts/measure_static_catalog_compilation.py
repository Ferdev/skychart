#!/usr/bin/env python3
"""Measure complete built-in metadata compilations without importing the app."""
import __future__
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess


def extract(source, settings):
    tree = ast.parse(source)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'catalog_object')
    assignment = next(n for n in tree.body if isinstance(n, ast.Assign) and
                      any(isinstance(t, ast.Name) and t.id == 'CATALOG_OBJECTS' for t in n.targets))
    groups = next(n.value for n in tree.body if isinstance(n, ast.Assign) and
                  any(isinstance(t, ast.Name) and t.id == 'CATALOG_GROUPS' for t in n.targets))
    # Fail closed if these definitions acquire execution beyond constructing
    # their literal dictionaries. Do not run module-level loaders or imports.
    if len(function.body) != 1 or not isinstance(function.body[0], ast.Return) or not isinstance(function.body[0].value, ast.Dict):
        raise ValueError('catalog constructor is no longer a plain dictionary')
    if function.decorator_list or any(isinstance(n, (ast.Call, ast.Attribute, ast.Subscript, ast.Lambda)) for n in ast.walk(function)):
        # Annotations are postponed, but the current signature uses subscripts
        # for list/dict types. Validate only executable defaults and body below.
        executable = [*function.body, *function.args.defaults,
                      *(n for n in function.args.kw_defaults if n is not None)]
        if function.decorator_list or any(isinstance(n, (ast.Call, ast.Attribute, ast.Subscript, ast.Lambda))
                                         for root in executable for n in ast.walk(root)):
            raise ValueError('catalog constructor contains dynamic expressions')
    if not isinstance(assignment.value, ast.List):
        raise ValueError('static catalogue is no longer a literal list')
    constants = {}
    for node in ast.parse(settings).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SUN_MU_KM3_S2' for t in node.targets):
            constants['SUN_MU_KM3_S2'] = ast.literal_eval(node.value)
    for call in assignment.value.elts:
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or call.func.id != 'catalog_object' or call.args:
            raise ValueError('unexpected static catalogue expression')
        for keyword in call.keywords:
            if keyword.arg is None:
                raise ValueError('dynamic keyword expansion')
            if isinstance(keyword.value, ast.Name) and keyword.value.id in constants:
                continue
            ast.literal_eval(keyword.value)
    module = ast.Module(body=[function, assignment], type_ignores=[])
    scope = dict(constants)
    exec(compile(module, '<verified-static-catalogue>', 'exec', flags=__future__.annotations.compiler_flag), scope)
    rows = scope['CATALOG_OBJECTS']
    if len({r['key'] for r in rows}) != len(rows):
        raise ValueError('duplicate public keys')
    return rows, ast.literal_eval(groups)


def measure(repo, output):
    revision = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    paths = ['backend/catalog_sources.py', 'backend/settings.py']
    inputs = []
    for path in paths:
        raw = (repo / path).read_bytes()
        committed = subprocess.check_output(['git', '-C', str(repo), 'show', revision + ':' + path])
        # Existing authorized development may already have changed this code;
        # pin both the revision and exact current bytes instead of hiding that.
        inputs.append({'path': path, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                       'matches_revision': raw == committed})
    rows, groups = extract((repo / paths[0]).read_text(), (repo / paths[1]).read_text())
    output.mkdir(parents=True, exist_ok=True)
    owner = output / 'OWNER'; marker = 'SkyChart isolated static compilation measurement 1271\n'
    if owner.exists():
        if owner.read_text() != marker:
            raise ValueError('unowned output')
    else:
        if any(output.iterdir()):
            raise ValueError('nonempty unowned output')
        owner.write_text(marker)
    results = []
    mapping = {'solar-system-core': ['core'], 'mars-satellites': ['mars_moons'],
               'giant-planet-satellites': ['jupiter_major_moons', 'saturn_major_moons'],
               'nearby-stars-curated': ['nearby_exoplanet_systems']}
    for catalog, selected in mapping.items():
        objects = [row for row in rows if row['catalog_group'] in selected]
        payload = {'source_revision': revision, 'source_files': inputs,
                   'groups': {g: groups[g] for g in selected}, 'objects': objects}
        raw = (json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()
        path = output / (catalog + '.json')
        if path.exists() and path.read_bytes() != raw:
            raise ValueError('pinned compilation changed')
        if not path.exists():
            path.write_bytes(raw)
        if json.loads(path.read_bytes()) != payload:
            raise ValueError('compilation roundtrip changed')
        results.append({'catalog': catalog, 'status': 'FULL_BUILTIN_METADATA_COMPILATION_MEASURED',
                        'file': path.name, 'rows': len(objects), 'bytes': len(raw),
                        'allocated_bytes': path.stat().st_blocks*512,
                        'sha256': hashlib.sha256(raw).hexdigest(),
                        'public_keys': [row['key'] for row in objects], 'source_revision': revision,
                        'source_files': inputs, 'full_source_bytes': None, 'full_serving_bytes': None,
                        'scope': 'All fields/defaults in the current built-in metadata records only. Shared source-code files count once across groups. JSON is an investigation artifact, not a new application data format.',
                        'remaining': 'Ephemeris/time coverage or upstream catalogue releases, runtime caches, indexes, native rendering/API budgets'})
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path); parser.add_argument('output', type=Path)
    a = parser.parse_args(); print(json.dumps(measure(a.repo.resolve(), a.output), indent=2))
