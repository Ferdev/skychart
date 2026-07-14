#!/usr/bin/env python3
"""Build the BASS DR2 catalog of AGNs with measured black-hole masses."""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "bass_dr2_black_holes.json"
VIZIER_TAP_URL = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
VIZIER_CATALOG_URL = "https://cdsarc.cds.unistra.fr/viz-bin/cat/J/ApJS/261/2"
PAPER_URL = "https://doi.org/10.3847/1538-4365/ac6c05"
TABLE_ID = "J/ApJS/261/2/table9"

LIGHT_YEARS_PER_MPC = 3_261_563.777
SCHWARZSCHILD_RADIUS_KM_PER_SOLAR_MASS = 2.95325008
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MIN_EXPECTED_RECORDS = 700
MAX_EXPECTED_RECORDS = 1_000

QUERY = f"""
SELECT
  "ID",
  "m_ID",
  "SWIFT",
  "CName",
  "RAJ2000",
  "DEJ2000",
  "Type",
  "z",
  "ztype",
  "Dist",
  "logMBH",
  "Method",
  "logLbol",
  "logEdd",
  "SimbadName"
FROM "{TABLE_ID}"
WHERE "logMBH" IS NOT NULL
  AND "Dist" > 0
ORDER BY "ID", "m_ID"
""".strip()

COLUMNS = [
    "ID",
    "m_ID",
    "SWIFT",
    "CName",
    "RAJ2000",
    "DEJ2000",
    "Type",
    "z",
    "ztype",
    "Dist",
    "logMBH",
    "Method",
    "logLbol",
    "logEdd",
    "SimbadName",
]


def fetch_json(query: str) -> dict[str, Any]:
    params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query}
    request = Request(
        f"{VIZIER_TAP_URL}?{urlencode(params)}",
        headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"},
    )
    with urlopen(request, timeout=120) as response:
        content_type = response.headers.get_content_type()
        if content_type not in {"application/json", "text/json"}:
            raise ValueError(f"VizieR TAP returned unexpected content type {content_type!r}")
        declared_size = response.headers.get("Content-Length")
        if declared_size and int(declared_size) > MAX_RESPONSE_BYTES:
            raise ValueError(f"VizieR TAP response exceeds {MAX_RESPONSE_BYTES} bytes")
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError(f"VizieR TAP response exceeds {MAX_RESPONSE_BYTES} bytes")
        return json.loads(body.decode("utf-8"))


def finite_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def slugify(value: str) -> str:
    normalized = value.strip().lower().replace("+", " plus ")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def reject_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: reject_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [reject_none(item) for item in value if item is not None]
    return value


def build_object(row: dict[str, Any]) -> dict[str, Any] | None:
    catalog_id = clean_text(row.get("ID"))
    component = clean_text(row.get("m_ID"))
    ra_deg = finite_float(row.get("RAJ2000"))
    dec_deg = finite_float(row.get("DEJ2000"))
    distance_mpc = finite_float(row.get("Dist"))
    log_mass = finite_float(row.get("logMBH"))
    if (
        not catalog_id
        or ra_deg is None
        or not 0 <= ra_deg < 360
        or dec_deg is None
        or not -90 <= dec_deg <= 90
        or distance_mpc is None
        or distance_mpc <= 0
        or log_mass is None
        or not 3 <= log_mass <= 12
    ):
        return None

    counterpart_name = clean_text(row.get("CName"))
    swift_name = clean_text(row.get("SWIFT"))
    simbad_name = clean_text(row.get("SimbadName"))
    display_name = counterpart_name or simbad_name or swift_name or f"BASS DR2 {catalog_id}{component or ''}"
    stable_id = f"{catalog_id}{component.lower() if component else ''}"
    mass_solar = 10.0**log_mass
    distance_ly = distance_mpc * LIGHT_YEARS_PER_MPC
    radius_km = mass_solar * SCHWARZSCHILD_RADIUS_KM_PER_SOLAR_MASS
    aliases = [display_name, f"BASS DR2 {catalog_id}{component or ''}"]
    aliases.extend(value for value in (swift_name, simbad_name) if value and value not in aliases)

    return reject_none(
        {
            "key": f"bass-dr2-black-hole-{slugify(stable_id)}",
            "name": display_name,
            "aliases": aliases,
            "object_type": "black_hole",
            "catalog_group": "bass_dr2_black_holes",
            "source_type": "bass_dr2_black_hole_mass",
            "position_model": "bass_dr2_catalog_distance_coordinates",
            "ra_deg": ra_deg,
            "dec_deg": dec_deg,
            "distance_ly": distance_ly,
            "color": "#d3afff",
            "radius_km": radius_km,
            "external_ids": {
                "bass_dr2_id": catalog_id,
                "bass_dr2_component": component,
                "swift_bat_name": swift_name,
                "simbad_name": simbad_name,
            },
            "facts": {
                "source_catalog": "BASS DR2 general hard-X-ray selected AGN properties",
                "source_table": TABLE_ID,
                "source_urls": [VIZIER_CATALOG_URL, PAPER_URL],
                "scientific_semantics": "Hard-X-ray-selected active galactic nucleus with a cataloged best black-hole mass estimate.",
                "host_simbad_name": simbad_name,
                "black_hole_mass_log10_solar": log_mass,
                "black_hole_mass_solar": mass_solar,
                "black_hole_mass_method": clean_text(row.get("Method")),
                "radius_model": "Schwarzschild radius derived from the cataloged best black-hole mass estimate",
                "agn_optical_type": clean_text(row.get("Type")),
                "redshift": finite_float(row.get("z")),
                "redshift_type": clean_text(row.get("ztype")),
                "catalog_distance_mpc": distance_mpc,
                "bolometric_luminosity_log_erg_s": finite_float(row.get("logLbol")),
                "eddington_ratio_log10": finite_float(row.get("logEdd")),
                "why_interesting": "A BASS DR2 active galactic nucleus with an explicit best estimate for its central supermassive black-hole mass.",
            },
            "why_interesting": "A BASS DR2 active galactic nucleus with an explicit best estimate for its central supermassive black-hole mass.",
        }
    )


def build_catalog(payload: dict[str, Any]) -> dict[str, Any]:
    raw_rows = payload.get("data")
    if not isinstance(raw_rows, list):
        raise ValueError("VizieR TAP payload is missing a data array")
    if any(not isinstance(values, list) or len(values) != len(COLUMNS) for values in raw_rows):
        raise ValueError("VizieR TAP row width does not match the pinned BASS DR2 schema")
    rows = [dict(zip(COLUMNS, values)) for values in raw_rows]
    objects = [item for row in rows if (item := build_object(row)) is not None]
    objects.sort(key=lambda item: (int(item["external_ids"]["bass_dr2_id"]), item["key"]))
    keys = [item["key"] for item in objects]
    if not MIN_EXPECTED_RECORDS <= len(objects) <= MAX_EXPECTED_RECORDS:
        raise ValueError(f"BASS DR2 selection returned an implausible {len(objects)} records")
    if len(keys) != len(set(keys)):
        raise ValueError("BASS DR2 selection produced duplicate stable keys")
    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": "BASS DR2 general hard-X-ray selected AGN properties",
            "authors": "Koss et al. (2022)",
            "bibcode": "2022ApJS..261....2K",
            "doi": "10.3847/1538-4365/ac6c05",
            "vizier_catalog": "J/ApJS/261/2",
            "vizier_table": TABLE_ID,
            "tap_url": VIZIER_TAP_URL,
            "catalog_url": VIZIER_CATALOG_URL,
            "paper_url": PAPER_URL,
            "query": QUERY,
            "data_terms": {
                "code_license_exclusion": "Upstream catalog measurements are not relicensed under the Cosmic Atlas MIT license.",
                "upstream_license": "No SPDX-style redistribution license is stated on the BASS DR2 or VizieR catalog page; review current upstream terms before redistribution.",
                "vizier_acknowledgment_doi": "10.26093/cds/vizier",
            },
        },
        "selection": {
            "criteria": "finite logMBH and positive catalog distance (Dist > 0)",
            "scientific_scope": "Hard-X-ray-selected AGNs represented by their central black-hole mass estimate; entries are not direct horizon detections.",
            "distance_model": "BASS DR2 catalog distance in Mpc converted directly to light-years",
            "radius_model": "Schwarzschild radius derived from BASS DR2 best black-hole mass",
        },
        "object_count": len(objects),
        "objects": objects,
    }


def main() -> None:
    catalog = build_catalog(fetch_json(QUERY))
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=OUTPUT_PATH.parent, delete=False) as handle:
        temp_path = Path(handle.name)
        handle.write(json.dumps(catalog, indent=2, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, OUTPUT_PATH)
    print(f"Wrote {catalog['object_count']} BASS DR2 black-hole records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
