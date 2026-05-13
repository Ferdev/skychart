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
OUTPUT_PATH = ROOT / "data" / "catalogs" / "simbad_extragalactic.json"
SIMBAD_TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
SIMBAD_DOC_URL = "https://simbad.cds.unistra.fr/guide/sim-tap"
NED_OBJECT_LOOKUP_URL = "https://ned.ipac.caltech.edu/byname"

LIGHT_YEAR_KM = 9_460_730_472_580.8
SPEED_OF_LIGHT_KM_S = 299_792.458
HUBBLE_KM_S_MPC = 67.8
OMEGA_M = 0.308
OMEGA_LAMBDA = 0.692

DEFAULT_LIMIT = int(os.environ.get("SIMBAD_EXTRAGALACTIC_LIMIT", "5000"))

QUERY = f"""
SELECT TOP {DEFAULT_LIMIT}
  oid,
  main_id,
  otype,
  otype_txt,
  ra,
  dec,
  rvz_redshift,
  nbref,
  galdim_majaxis,
  galdim_minaxis
FROM basic
WHERE ra IS NOT NULL
  AND dec IS NOT NULL
  AND rvz_redshift IS NOT NULL
  AND rvz_redshift > 0
  AND otype IN ('QSO','AGN','BLL','Bla','SyG','Rad','G')
ORDER BY nbref DESC
""".strip()

COLUMNS = [
    "oid",
    "main_id",
    "otype",
    "otype_txt",
    "ra",
    "dec",
    "rvz_redshift",
    "nbref",
    "galdim_majaxis",
    "galdim_minaxis",
]

TYPE_INFO = {
    "QSO": {
        "object_type": "quasar",
        "label": "Quasar",
        "color": "#d7c2ff",
        "interesting": "Quasar from SIMBAD, a bright active galactic nucleus powered by accretion onto a supermassive black hole.",
    },
    "AGN": {
        "object_type": "active_galaxy",
        "label": "Active galactic nucleus",
        "color": "#f2c36b",
        "interesting": "Active galactic nucleus from SIMBAD, tracing black-hole accretion in a galaxy core.",
    },
    "BLL": {
        "object_type": "active_galaxy",
        "label": "BL Lac object",
        "color": "#b7b5ff",
        "interesting": "BL Lac active galaxy from SIMBAD, usually interpreted as a jet-dominated active nucleus.",
    },
    "Bla": {
        "object_type": "active_galaxy",
        "label": "Blazar",
        "color": "#b7b5ff",
        "interesting": "Blazar from SIMBAD, a jet-aligned active galactic nucleus.",
    },
    "SyG": {
        "object_type": "active_galaxy",
        "label": "Seyfert galaxy",
        "color": "#e0b56d",
        "interesting": "Seyfert galaxy from SIMBAD, a nearby active-galaxy class.",
    },
    "Rad": {
        "object_type": "active_galaxy",
        "label": "Radio source",
        "color": "#a7d8ff",
        "interesting": "Radio source from SIMBAD with extragalactic redshift.",
    },
    "G": {
        "object_type": "galaxy",
        "label": "Galaxy",
        "color": "#d9b86f",
        "interesting": "Galaxy from SIMBAD with measured redshift.",
    },
}


def fetch_json(query: str) -> dict[str, Any]:
    params = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "json",
        "QUERY": query,
    }
    request = Request(
        f"{SIMBAD_TAP_URL}?{urlencode(params)}",
        headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"},
    )
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
        coefficient = 4 if index % 2 == 1 else 2
        total += coefficient * inverse_e(index * dz)

    integral = total * dz / 3.0
    return (SPEED_OF_LIGHT_KM_S / HUBBLE_KM_S_MPC) * integral


def angular_diameter_ly(distance_ly: float, angular_arcmin: float | None) -> float | None:
    if angular_arcmin is None or angular_arcmin <= 0:
        return None
    radians = math.radians(angular_arcmin / 60.0)
    diameter = distance_ly * 2.0 * math.tan(radians / 2.0)
    return diameter if math.isfinite(diameter) and diameter > 0 else None


def build_object(row: dict[str, Any]) -> dict[str, Any] | None:
    main_id = str(row.get("main_id") or "").strip()
    ra_deg = finite_float(row.get("ra"))
    dec_deg = finite_float(row.get("dec"))
    redshift = finite_float(row.get("rvz_redshift"))
    if not main_id or ra_deg is None or dec_deg is None or redshift is None or redshift <= 0:
        return None

    otype = str(row.get("otype") or "").strip()
    type_info = TYPE_INFO.get(otype, TYPE_INFO["G"])
    oid = str(row.get("oid") or "").strip()
    distance_mpc = comoving_distance_mpc(redshift)
    distance_ly = distance_mpc * 3_261_563.777
    major_arcmin = finite_float(row.get("galdim_majaxis"))
    minor_arcmin = finite_float(row.get("galdim_minaxis"))
    physical_diameter_ly = angular_diameter_ly(distance_ly, major_arcmin)
    physical_minor_diameter_ly = angular_diameter_ly(distance_ly, minor_arcmin)

    radius_km = (physical_diameter_ly * LIGHT_YEAR_KM / 2.0) if physical_diameter_ly else 0.0
    key_suffix = slugify(main_id) or f"oid-{oid}"

    return {
        "key": f"simbad-{key_suffix}",
        "name": main_id,
        "aliases": [main_id, f"SIMBAD {main_id}", f"SIMBAD OID {oid}"] if oid else [main_id, f"SIMBAD {main_id}"],
        "object_type": type_info["object_type"],
        "catalog_group": "simbad_extragalactic",
        "source_type": "simbad_tap",
        "position_model": "simbad_redshift_distance_coordinates",
        "ra_deg": ra_deg,
        "dec_deg": dec_deg,
        "distance_ly": distance_ly,
        "color": type_info["color"],
        "radius_km": radius_km,
        "external_ids": {
            "simbad_oid": oid or None,
            "simbad_main_id": main_id,
        },
        "facts": {
            "simbad_object_type": otype,
            "simbad_object_type_label": row.get("otype_txt") or type_info["label"],
            "redshift": redshift,
            "redshift_distance_mpc": distance_mpc,
            "distance_quality": "cosmology_from_simbad_redshift",
            "reference_count": finite_int(row.get("nbref")),
            "angular_major_arcmin": major_arcmin,
            "angular_minor_arcmin": minor_arcmin,
            "physical_diameter_ly": physical_diameter_ly,
            "physical_minor_diameter_ly": physical_minor_diameter_ly,
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
            "ned_lookup_url": NED_OBJECT_LOOKUP_URL,
            "query": QUERY,
        },
        "selection": {
            "limit": DEFAULT_LIMIT,
            "object_types": sorted(TYPE_INFO.keys()),
            "minimum_redshift": "> 0",
            "ordering": "SIMBAD reference count descending",
            "distance_model": f"Flat Lambda-CDM approximation, H0={HUBBLE_KM_S_MPC}, omega_m={OMEGA_M}, omega_lambda={OMEGA_LAMBDA}",
        },
        "object_count": len(objects),
        "objects": objects,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {output['object_count']} SIMBAD extragalactic objects to {OUTPUT_PATH}")


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


if __name__ == "__main__":
    main()
