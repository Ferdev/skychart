"""Dated mission positions, independent of the core ephemeris request.

One bounded priority worker serializes provider access. A response never waits
for the mission catalog to be downloaded. Missing coordinates are JSON null.
"""
from __future__ import annotations
import json
import math
import queue
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from backend.errors import QueryInputError
from backend.payload_cache import cache_key_payload, read_cache, write_cache

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / 'backend_phoenix/priv/spacecraft.json').read_text())
MISSIONS = {row['key']: row for row in MANIFEST['spacecraft']}
_jobs = queue.PriorityQueue(maxsize=256)
_lock = threading.Lock()
_pending = {}
_provider_lock = threading.Lock()
_retry_after = 0.0
_results = {}
_worker = None
_sequence = 0


def in_coverage(mission, timestamp):
    from backend.scientific_calculation import skyfield_context
    timescale, _ = skyfield_context()
    jd = float(timescale.from_datetime(timestamp).tdb)
    if not mission['jd_start_tdb'] <= jd <= mission['jd_end_tdb']: return False
    end = mission.get('end_utc')
    return not end or timestamp < datetime.fromisoformat(end.replace('Z', '+00:00'))


def metadata_body(mission, timestamp, status):
    return {
        'key': mission['key'], 'name': mission['name'], 'object_type':'spacecraft',
        'radius_km':None, 'color':'#77d9d0', 'parent_key':'sun', 'catalog_group':'spacecraft',
        'aliases':mission['aliases'], 'spacecraft':{**mission, 'availability':status,
            'position_epoch':timestamp.isoformat(), 'audited_at':MANIFEST['retrieved_at']},
        'position':None, 'distance_from_earth_km':None,
        'catalog':{'source_type':'spacecraft', 'position_model':'jpl_spacecraft_vectors',
            'dynamic_position':True, 'aliases':mission['aliases'],
            'external_ids':{'horizons_id':mission['horizons_id']},
            'external_links':[{'provider':'NASA/JPL', 'label':'Trajectory and coverage', 'url':mission['source_url']}]
                + ([{'provider':mission.get('agency'), 'label':'Mission', 'url':mission['mission_url']}] if mission.get('mission_url') else []),
            'source':{'label':'NASA/JPL Horizons', 'url':mission['source_url']}}
    }


def calculate(mission, timestamp):
    global _retry_after
    from backend.scientific_calculation import horizons_vector_payload, skyfield_context, vector_payload
    body = metadata_body(mission, timestamp, 'out_of_coverage')
    if not in_coverage(mission, timestamp): return body
    try:
        with _provider_lock:
            if time.monotonic() < _retry_after:
                body['spacecraft']['availability'] = 'temporarily_unavailable'
                return body
            position = horizons_vector_payload({**mission, 'parent_key':'sun', 'source_type':'spacecraft'}, timestamp)
        if not all(math.isfinite(position[k]) for k in ('x_km','y_km','z_km','vx_km_s','vy_km_s','vz_km_s')):
            raise RuntimeError('Non-finite state')
        ts, eph = skyfield_context()
        earth = vector_payload((eph['earth'] - eph['sun']).at(ts.from_datetime(timestamp)))
        body['position'] = position
        body['distance_from_earth_km'] = math.sqrt(sum((position[k]-earth[k])**2 for k in ('x_km','y_km','z_km')))
        body['spacecraft'].update(availability='available', heliocentric_speed_km_s=math.sqrt(sum(position[k]**2 for k in ('vx_km_s','vy_km_s','vz_km_s'))))
    except OSError:
        _retry_after = time.monotonic() + 60
        body['spacecraft']['availability'] = 'temporarily_unavailable'
    except (RuntimeError, ValueError):
        body['spacecraft']['availability'] = 'temporarily_unavailable'
    return body


def _run():
    while True:
        _, _, key, mission, timestamp, disk_key = _jobs.get()
        try:
            with _lock: existing = _results.get(key)
            if existing and existing['expires_at'] > time.time(): continue
            body = calculate(mission, timestamp)
            ttl = 86400 if body['spacecraft']['availability'] == 'available' else 60
            result = {'expires_at':time.time()+ttl, 'body':body}
            if ttl > 60: write_cache('spacecraft', disk_key, result)
            with _lock:
                if len(_results) >= 512: _results.pop(next(iter(_results)))
                _results[key] = result
        except Exception:
            with _lock:
                _results[key] = {'expires_at':time.time()+60, 'body':metadata_body(mission,timestamp,'temporarily_unavailable')}
        finally:
            with _lock: _pending.pop(key, None)
            _jobs.task_done()
        time.sleep(.1)


def spacecraft_payload(timestamp, selected_key=''):
    global _worker, _sequence
    if selected_key and selected_key not in MISSIONS: raise QueryInputError('Unknown spacecraft key')
    stamp = timestamp.isoformat()
    bodies = []
    with _lock:
        if _worker is None:
            _worker = threading.Thread(target=_run, daemon=True, name='spacecraft-horizons'); _worker.start()
    missions = sorted(MISSIONS.values(), key=lambda m: (m['key'] != selected_key, m['horizons_id'] not in ('-31','-32','-98')))
    for mission in missions:
        if not in_coverage(mission, timestamp):
            bodies.append(metadata_body(mission,timestamp,'out_of_coverage')); continue
        key = (mission['key'], stamp)
        disk_key = cache_key_payload('spacecraft', key=key, revision=mission['source_sha256'], frame='heliocentric-ecliptic-J2000-v1')
        with _lock: result = _results.get(key)
        if result is None: result = read_cache('spacecraft', disk_key)
        if result and result.get('expires_at',0) > time.time():
            bodies.append(result['body']); continue
        with _lock:
            priority = 0 if mission['key'] == selected_key else 1
            if (key not in _pending or priority < _pending[key]) and not _jobs.full():
                _sequence += 1; _pending[key] = priority
                _jobs.put_nowait((priority, _sequence, key, mission, timestamp, disk_key))
        bodies.append(metadata_body(mission,timestamp,'loading'))
    return {'timestamp_utc':stamp, 'bodies':bodies}
