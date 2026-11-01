#!/usr/bin/env python3
"""Builds data/catalogs/transit_targets.json: deep transits of bright hosts for small telescopes.

The planet snapshots keep the ephemeris of each planet, but confirmed planets have no
transit depth or host magnitude there. This file adds those values for the short list
that a home telescope can time. Confirmed rows come from the NASA Exoplanet Archive
Planetary Systems Composite Parameters table, and candidate rows come from the local
candidate snapshot. No row changes an archive value.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "transit_targets.json"
SYSTEMS_PATH = ROOT / "data" / "catalogs" / "exoplanet_systems.json"
CANDIDATES_PATH = ROOT / "data" / "catalogs" / "exoplanet_candidates.json"
TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
SCHEMA_VERSION = 1
# A 0.5 % dip of a star of magnitude 12.5 is the limit of a small telescope on one night.
MIN_DEPTH_PPT = 5.0
MAX_MAGNITUDE = 12.5
MAX_PERIOD_DAYS = 30.0
MIN_DURATION_HOURS = 0.5
MAX_DURATION_HOURS = 8.0
# Only barycentric dynamical time gives a prediction that is correct to the second.
TIME_SYSTEMS = {"BJD-TDB", "BJD_TDB", "BJD/TDB"}
CONFIRMED_QUERY = f"""
select pl_name, hostname, ra, dec, sy_vmag, sy_gaiamag, pl_orbper, pl_orbpererr1, pl_orbpererr2,
  pl_tranmid, pl_tranmiderr1, pl_tranmiderr2, pl_tranmid_systemref, pl_tranmid_reflink,
  pl_trandep, pl_trandur
from pscomppars
where tran_flag = 1 and pl_trandep >= {MIN_DEPTH_PPT / 10} and sy_vmag <= {MAX_MAGNITUDE}
  and pl_orbper <= {MAX_PERIOD_DAYS} and pl_tranmid is not null and pl_trandur is not null
""".strip()


def fetch_rows() -> list[dict[str, Any]]:
    url = f"{TAP_URL}?{urlencode({'query': CONFIRMED_QUERY, 'format': 'json'})}"
    with urlopen(Request(url, headers={"User-Agent": "cosmic-atlas-catalog-builder"}), timeout=180) as response:
        rows = json.loads(response.read())
    if not isinstance(rows, list):
        raise RuntimeError("Unexpected TAP response")
    return rows


def largest_error(*values: Any) -> float | None:
    numbers = [abs(float(value)) for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    return max(numbers) if numbers else None


def reference_label(link: Any) -> str | None:
    text = str(link or "")
    if ">" not in text:
        return None
    return text.split(">", 1)[1].split("<", 1)[0].strip() or None


def planet_keys(systems: list[dict[str, Any]]) -> dict[str, tuple[str, str]]:
    return {planet["name"]: (planet["key"], system["key"]) for system in systems for planet in system.get("planets", [])}


def duration_allowed(hours: float | None) -> bool:
    return hours is not None and MIN_DURATION_HOURS <= hours <= MAX_DURATION_HOURS


def confirmed_target(row: dict[str, Any], keys: dict[str, tuple[str, str]]) -> dict[str, Any] | None:
    known = keys.get(row["pl_name"])
    if known is None or str(row.get("pl_tranmid_systemref") or "").upper() not in TIME_SYSTEMS:
        return None
    period_error = largest_error(row.get("pl_orbpererr1"), row.get("pl_orbpererr2"))
    time_error = largest_error(row.get("pl_tranmiderr1"), row.get("pl_tranmiderr2"))
    duration = row.get("pl_trandur")
    if period_error is None or time_error is None or not duration_allowed(duration):
        return None
    return {
        "key": known[0],
        "host_key": known[1],
        "name": row["pl_name"],
        "host_name": row["hostname"],
        "status": "confirmed",
        "ra_deg": float(row["ra"]),
        "dec_deg": float(row["dec"]),
        "magnitude": round(float(row["sy_vmag"]), 2),
        "magnitude_band": "V",
        "period_days": float(row["pl_orbper"]),
        "period_err_days": period_error,
        "reference_time_bjd": float(row["pl_tranmid"]),
        "reference_time_err_days": time_error,
        "depth_ppt": round(float(row["pl_trandep"]) * 10, 3),
        "duration_hours": round(float(duration), 3),
        "reference_label": reference_label(row.get("pl_tranmid_reflink")),
    }


def candidate_targets(systems: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for system in systems:
        magnitude = system.get("tess_magnitude")
        if not isinstance(magnitude, (int, float)) or magnitude > MAX_MAGNITUDE:
            continue
        for planet in system.get("candidates", []):
            period = planet.get("ephemeris_period_days")
            depth = planet.get("transit_depth_ppm")
            duration = planet.get("transit_duration_hours")
            if (
                not isinstance(depth, (int, float)) or depth < MIN_DEPTH_PPT * 1000
                or not isinstance(period, (int, float)) or period > MAX_PERIOD_DAYS
                or not duration_allowed(duration)
                or planet.get("disposition") != "planet_candidate"
                or planet.get("ephemeris_reference_type") != "conjunction"
                or str(planet.get("ephemeris_time_system") or "").upper() not in TIME_SYSTEMS
            ):
                continue
            period_error = largest_error(planet.get("ephemeris_period_days_err_minus"), planet.get("ephemeris_period_days_err_plus"))
            time_error = largest_error(planet.get("ephemeris_reference_time_jd_err_minus"), planet.get("ephemeris_reference_time_jd_err_plus"))
            if period_error is None or time_error is None:
                continue
            rows.append({
                "key": planet["key"],
                "host_key": system["key"],
                "name": planet["name"],
                "host_name": system["name"],
                "status": "candidate",
                "ra_deg": float(system["ra_deg"]),
                "dec_deg": float(system["dec_deg"]),
                "magnitude": round(float(magnitude), 2),
                "magnitude_band": "TESS",
                "period_days": float(period),
                "period_err_days": period_error,
                "reference_time_bjd": float(planet["ephemeris_reference_time_jd"]),
                "reference_time_err_days": time_error,
                "depth_ppt": round(float(depth) / 1000, 3),
                "duration_hours": round(float(duration), 3),
                "reference_label": planet.get("source_catalog"),
            })
    return rows


def build(rows: list[dict[str, Any]], systems: list[dict[str, Any]], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    keys = planet_keys(systems)
    confirmed = [target for target in (confirmed_target(row, keys) for row in rows) if target is not None]
    unconfirmed = candidate_targets(candidates)
    targets = sorted(confirmed + unconfirmed, key=lambda row: (row["status"] != "confirmed", row["key"]))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "confirmed": "NASA Exoplanet Archive Planetary Systems Composite Parameters (pscomppars)",
            "candidates": "data/catalogs/exoplanet_candidates.json",
            "url": "https://exoplanetarchive.ipac.caltech.edu/",
        },
        "limits": {
            "min_depth_ppt": MIN_DEPTH_PPT,
            "max_magnitude": MAX_MAGNITUDE,
            "max_period_days": MAX_PERIOD_DAYS,
            "duration_hours": [MIN_DURATION_HOURS, MAX_DURATION_HOURS],
            "time_system": "BJD-TDB",
        },
        "coverage": {"source_rows": len(rows), "confirmed": len(confirmed), "candidates": len(unconfirmed)},
        "targets": targets,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    arguments = parser.parse_args()
    systems = json.loads(SYSTEMS_PATH.read_text(encoding="utf-8"))["systems"]
    candidates = json.loads(CANDIDATES_PATH.read_text(encoding="utf-8"))["systems"]
    payload = build(fetch_rows(), systems, candidates)
    arguments.output.write_text(json.dumps(payload, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(payload["coverage"]))


if __name__ == "__main__":
    main()
