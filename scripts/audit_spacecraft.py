"""Rebuild the reviewed Horizons spacecraft inventory (serial requests, resumable)."""
import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
SUPPORT = 'https://ssd.jpl.nasa.gov/api/horizons_support.api?time-span=1&list=spacecraft'
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
# Separate trajectory solutions are not separate vehicles. Surface objects need a
# reviewed landing cutoff/model before admission. Earth satellite/TLE solutions
# require a separate freshness audit; do not trust a broad SPK envelope for them.
EXCLUDED = {-39: 'Provider labels trajectory obsolete and for testing only', -182: 'No tracking since deployment; unvalidated nominal trajectory', -40000: 'Alternate Clementine solution', -33: 'Unflown mission design', -211: 'Unflown mission design',
 -530: 'Surface mission needs landing cutoff', -76: 'Surface mission needs landing cutoff',
 -84: 'Surface mission needs landing cutoff', -150: 'Surface mission needs landing cutoff',
 -153: 'Surface mission needs landing cutoff', -158: 'Surface mission needs landing cutoff',
 -168: 'Surface mission needs landing cutoff', -189: 'Surface mission needs landing cutoff',
 -240: 'Surface mission needs landing cutoff', -253: 'Surface mission needs landing cutoff',
 -254: 'Surface mission needs landing cutoff', -344: 'Atmospheric probe needs termination cutoff'}

def fetch(url):
    for attempt in range(3):
        try:
            with urlopen(url, timeout=20) as response: return response.read().decode()
        except OSError:
            if attempt == 2: raise
            time.sleep(2 ** attempt)

def launch_date(metadata):
    lines = metadata.splitlines()
    for index, line in enumerate(lines):
        if re.search(r'pre.launch|nominal|plan|mass', line, re.I): continue
        label = re.match(r'^\s*(?:MISSION\s+)?LAUNCH(?:ED)?(?:\s+DATE)?\s*:', line, re.I)
        dated_event = re.match(r'^\s*\d{4}-[A-Za-z]{3}-\d{1,2}\s+Launch\b', line, re.I)
        if not label and not dated_event: continue
        text = line
        if label and not re.search(r'\d{4}', line) and index+1 < len(lines):
            # Only a dedicated date field can continue on the next line.
            following = lines[index+1]
            if re.match(r'^\s*\d{4}-[A-Za-z]{3}-\d{1,2}\b', following): text += ' ' + following
        for pattern, formats in [
            (r'\b(\d{4}-[A-Za-z]{3}-\d{1,2})\b', ['%Y-%b-%d']),
            (r'\b([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})\b', ['%b %d %Y']),
        ]:
            match = re.search(pattern, text)
            if match:
                try: return datetime.strptime(' '.join(match[1].replace(',', '').split()), formats[0]).date().isoformat()
                except ValueError: pass
    return None


def build(cache):
    cache.mkdir(parents=True, exist_ok=True)
    inventory = json.loads(fetch(SUPPORT))['list'][0]['list']
    aliases = fetch(API + '?' + urlencode({'format':'text', 'COMMAND':"'*'", 'MAKE_EPHEM':'NO'}))
    alias_by_id = {int(line[:9]): line[59:].split() for line in aliases.splitlines() if re.match(r'\s+-\d+\s', line)}
    included, excluded = [], []
    now = datetime.now(timezone.utc).isoformat()
    for row in inventory:
        ident = int(row['id']); name = re.sub(r'\s*\(spacecraft.*|\s*\(Spacecraft.*', '', row['name']).strip()
        reason = EXCLUDED.get(ident)
        if re.search(r'booster|stage|centaur|\bRB\b|S-IVB|fragment|simulation|ICPS', name, re.I): reason = 'Rocket stage, debris or simulated target'
        if ident <= -100000: reason = reason or 'Earth-satellite/TLE or special trajectory requires separate freshness review'
        if not row.get('jd_min') or not row.get('jd_max'): reason = 'No trajectory envelope'
        if reason:
            excluded.append({'horizons_id':str(ident), 'name':name, 'reason':reason}); continue
        url = API + '?' + urlencode({'format':'text','COMMAND':f"'{ident}'",'MAKE_EPHEM':'NO'})
        path = cache / f'{ident}.txt'
        if not path.exists(): path.write_text(fetch(url)); time.sleep(.15)
        metadata = path.read_text()
        revision = re.search(r'Revised:\s*(.+?)\s{2,}', metadata)
        # Coverage is an envelope in TDB, NOT a claim that all internal dates work.
        # Every rendered epoch must also succeed against Horizons' vector table.
        item = {'key':f'spacecraft-{abs(ident)}', 'name':name, 'horizons_id':str(ident),
                'aliases':alias_by_id.get(ident, []), 'coverage_start_tdb':row['cd_min'],
                'coverage_end_tdb':row['cd_max'], 'jd_start_tdb':row['jd_min'], 'jd_end_tdb':row['jd_max'],
                'source_url':url, 'source_revision':revision.group(1).strip() if revision else None,
                'source_sha256':hashlib.sha256(metadata.encode()).hexdigest(),
                'trajectory_kind':'Provider trajectory; may combine reconstructed and predicted segments',
                'launch_date':launch_date(metadata), 'agency':None}
        included.append(item)
        print(name, flush=True)
    overrides = json.loads((ROOT/'scripts/data/spacecraft_metadata.json').read_text())
    for item in included: item.update(overrides.get(item['horizons_id'], {}))
    result = {'schema_version':1, 'retrieved_at':now, 'source_url':SUPPORT,
              'coverage_note':'TDB coverage envelopes only; internal gaps are checked at each requested epoch.',
              'spacecraft':included,'excluded':excluded}
    (ROOT/'backend_phoenix/priv/spacecraft.json').write_text(json.dumps(result, indent=2)+'\n')
    print(f'{len(included)} included, {len(excluded)} excluded')

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--cache',type=Path,default=Path('/tmp/spacecraft-audit')); a=p.parse_args(); build(a.cache)
