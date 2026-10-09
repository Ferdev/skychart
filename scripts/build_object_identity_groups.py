"""Build source-backed Messier/OpenNGC links and static Solar System metadata."""
import json
import math
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.catalog_sources import CATALOG_OBJECTS

def rows(name):
    data = json.loads((ROOT / 'data/catalogs' / name).read_text())
    return next(v for v in data.values() if isinstance(v, list) and v and isinstance(v[0], dict))

def build():
    ngc = {o['key']: o for o in rows('ngc_ic_deep_sky.json')}
    groups = []
    for obj in rows('deep_sky_catalog.json'):
        keys = [obj['key']]
        for cat in ('ngc', 'ic'):
            ident = str(obj.get(cat) or '')
            if not ident.isdigit():
                continue
            key = f'{cat}-{int(ident)}'
            candidate = ngc.get(key)
            if not candidate:
                continue
            # Both the explicit catalog identifier and consistent coordinates are required.
            dra = ((obj['ra_deg'] - candidate['ra_deg'] + 180) % 360 - 180)
            separation = math.hypot(dra * math.cos(math.radians(obj['dec_deg'])), obj['dec_deg'] - candidate['dec_deg'])
            if separation < 0.3 and candidate.get('messier') == obj.get('messier'):
                keys.append(key)
        if len(keys) > 1:
            groups.append({'keys': keys, 'evidence': 'Reciprocal Messier NGC/IC identifiers; rounded catalog coordinates agree within 0.3 degree'})
    # Reviewed aliases from the source's explicit M31/M87 identification.
    for group in groups:
        if 'm31' in group['keys']:
            group['keys'].append('local-volume-andromeda')
        if 'm87' in group['keys']:
            group['keys'] += ['virgo-m87', 'simbad-m-87']
    seen = set()
    for group in groups:
        for key in group['keys']:
            if key in seen:
                raise ValueError(f'Conflicting identity: {key}')
            seen.add(key)
    core = [{k: o.get(k) for k in ('key', 'name', 'object_type', 'parent_key', 'radius_km', 'color', 'catalog_group')}
            for o in CATALOG_OBJECTS if o['catalog_group'] in ('core','mars_moons','jupiter_major_moons','saturn_major_moons')]
    return {'version': 1, 'groups': groups, 'core': core}

if __name__ == '__main__':
    data = build()
    for path in ('data/catalogs/object_identity_groups.json', 'backend_phoenix/priv/community/identity.json'):
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, indent=2) + '\n')
    print(f"{len(data['groups'])} identity groups; {len(data['core'])} dynamic Solar System subjects")
