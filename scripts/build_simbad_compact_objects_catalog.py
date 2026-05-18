#!/usr/bin/env python3
"""Build a SIMBAD compact-object catalog for black holes and pulsars."""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "simbad_compact_objects.json"
SIMBAD_TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
SIMBAD_DOC_URL = "https://simbad.cds.unistra.fr/guide/sim-tap"

SPEED_OF_LIGHT_KM_S = 299_792.458
HUBBLE_KM_S_MPC = 67.8
OMEGA_M = 0.308
OMEGA_LAMBDA = 0.692
DEFAULT_LIMIT = int(os.environ.get("SIMBAD_COMPACT_OBJECT_LIMIT", "5000"))
PULSAR_DISPLAY_DISTANCE_PC = float(os.environ.get("SIMBAD_PULSAR_DISPLAY_DISTANCE_PC", "8000"))
BLACK_HOLE_DISPLAY_DISTANCE_PC = float(os.environ.get("SIMBAD_BLACK_HOLE_DISPLAY_DISTANCE_PC", "50000"))

QUERY = f"""
SELECT TOP {DEFAULT_LIMIT}
  oid,
  main_id,
  otype,
  otype_txt,
  ra,
  dec,
  plx_value,
  rvz_redshift,
  nbref
FROM basic
WHERE ra IS NOT NULL
  AND dec IS NOT NULL
  AND otype IN ('BH', 'BH?', 'Psr')
ORDER BY nbref DESC
""".strip()

COLUMNS = ["oid", "main_id", "otype", "otype_txt", "ra", "dec", "plx_value", "rvz_redshift", "nbref"]

TYPE_INFO = {
    "BH": {
        "object_type": "black_hole",
        "label": "Black hole",
        "color": "#17151f",
        "interesting": "Black-hole candidate from SIMBAD.",
    },
    "BH?": {
        "object_type": "black_hole",
        "label": "Black hole candidate",
        "color": "#17151f",
        "interesting": "Black-hole candidate from SIMBAD.",
    },
    "Psr": {
        "object_type": "pulsar",
        "label": "Pulsar",
        "color": "#8fe6ff",
        "interesting": "Pulsar from SIMBAD, a rapidly rotating neutron star visible through periodic emission.",
    },
}


def fetch_json(query: str) -> dict[str, Any]:
    params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query}
    request = Request(f"{SIMBAD_TAP_URL}?{urlencode(params)}", headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def finite_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def finite_int(value: Any) -> int | None:
    number = finite_float(value)
    return int(number) if number is not None else None


def slugify(value: str) -> str:
    normalized = value.strip().lower().replace("+", " plus ")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def comoving_distance_mpc(redshift: float) -> float:
    if redshift <= 0:
        return 0.0
    steps = 256 if redshift < 1.0 else 512
    if steps % 2 == 1:
        steps += 1
    dz = redshift / steps

    def inverse_e(z_value: float) -> float:
        return 1.0 / math.sqrt(OMEGA_M * (1.0 + z_value) ** 3 + OMEGA_LAMBDA)

    total = inverse_e(0.0) + inverse_e(redshift)
    for index in range(1, steps):
        total += (4 if index % 2 == 1 else 2) * inverse_e(index * dz)
    return (SPEED_OF_LIGHT_KM_S / HUBBLE_KM_S_MPC) * (total * dz / 3.0)


def distance_pc_for(row: dict[str, Any], object_type: str) -> tuple[float, str]:
    parallax_mas = finite_float(row.get("plx_value"))
    if parallax_mas is not None and parallax_mas > 0:
        return 1000.0 / parallax_mas, "simbad_parallax"

    redshift = finite_float(row.get("rvz_redshift"))
    if redshift is not None and redshift > 0:
        return comoving_distance_mpc(redshift) * 1_000_000.0, "cosmology_from_simbad_redshift"

    if object_type == "pulsar":
        return PULSAR_DISPLAY_DISTANCE_PC, "display_shell_no_simbad_distance"
    return BLACK_HOLE_DISPLAY_DISTANCE_PC, "display_shell_no_simbad_distance"


def build_object(row: dict[str, Any]) -> dict[str, Any] | None:
    main_id = str(row.get("main_id") or "").strip()
    ra_deg = finite_float(row.get("ra"))
    dec_deg = finite_float(row.get("dec"))
    if not main_id or ra_deg is None or dec_deg is None:
        return None

    otype = str(row.get("otype") or "").strip()
    type_info = TYPE_INFO.get(otype)
    if type_info is None:
        return None

    object_type = type_info["object_type"]
    distance_pc, distance_quality = distance_pc_for(row, object_type)
    oid = str(row.get("oid") or "").strip()
    key_suffix = slugify(main_id) or f"oid-{oid}"
    redshift = finite_float(row.get("rvz_redshift"))
    parallax_mas = finite_float(row.get("plx_value"))

    return {
        "key": f"simbad-{object_type}-{key_suffix}",
        "name": main_id,
        "aliases": [main_id, f"SIMBAD {main_id}", f"SIMBAD OID {oid}"] if oid else [main_id, f"SIMBAD {main_id}"],
        "object_type": object_type,
        "catalog_group": "simbad_compact_objects",
        "source_type": "simbad_tap",
        "position_model": "simbad_compact_object_coordinates",
        "ra_deg": ra_deg,
        "dec_deg": dec_deg,
        "distance_pc": distance_pc,
        "color": type_info["color"],
        "radius_km": 0.0,
        "external_ids": {
            "simbad_oid": oid or None,
            "simbad_main_id": main_id,
        },
        "facts": {
            "simbad_object_type": otype,
            "simbad_object_type_label": row.get("otype_txt") or type_info["label"],
            "reference_count": finite_int(row.get("nbref")),
            "parallax_mas": parallax_mas,
            "redshift": redshift,
            "distance_quality": distance_quality,
            "display_distance_pc": distance_pc if distance_quality.startswith("display_shell") else None,
            "why_interesting": type_info["interesting"],
        },
        "why_interesting": type_info["interesting"],
    }


def reject_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: reject_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [reject_none(item) for item in value if item is not None]
    return value


def uniquify_keys(objects: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for item in objects:
        key = item["key"]
        if key not in seen:
            seen.add(key)
            continue
        suffix = slugify(str(item.get("external_ids", {}).get("simbad_oid") or "duplicate"))
        next_key = f"{key}-{suffix}"
        counter = 2
        while next_key in seen:
            next_key = f"{key}-{suffix}-{counter}"
            counter += 1
        item["key"] = next_key
        seen.add(next_key)


def main() -> None:
    payload = fetch_json(QUERY)
    rows = [dict(zip(COLUMNS, values)) for values in payload.get("data", [])]
    objects = [build_object(row) for row in rows]
    objects = [reject_none(object_item) for object_item in objects if object_item is not None]
    uniquify_keys(objects)
    objects.sort(key=lambda item: (item["object_type"], -(item.get("facts", {}).get("reference_count") or 0), item["name"].lower()))

    output = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": "SIMBAD TAP basic table",
            "tap_url": SIMBAD_TAP_URL,
            "documentation_url": SIMBAD_DOC_URL,
            "query": QUERY,
        },
        "selection": {
            "limit": DEFAULT_LIMIT,
            "object_types": sorted(TYPE_INFO.keys()),
            "ordering": "black holes first, then SIMBAD reference count descending",
            "distance_model": "Parallax when available; redshift cosmology when available; otherwise display shell for sky placement.",
        },
        "object_count": len(objects),
        "objects": objects,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    counts = {object_type: sum(1 for item in objects if item["object_type"] == object_type) for object_type in sorted({item["object_type"] for item in objects})}
    print(f"Wrote {output['object_count']} SIMBAD compact objects to {OUTPUT_PATH}: {counts}")


if __name__ == "__main__":
    main()
