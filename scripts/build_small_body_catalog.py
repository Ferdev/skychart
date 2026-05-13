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
OUTPUT_PATH = ROOT / "data" / "catalogs" / "small_bodies.json"
SBDB_QUERY_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api"
SBDB_DOC_URL = "https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html"
SBDB_FILTER_DOC_URL = "https://ssd-api.jpl.nasa.gov/doc/sbdb_filter.html"

AU_KM = 149_597_870.700
DEFAULT_ASTEROID_ALBEDO = 0.14
DEFAULT_COMET_ALBEDO = 0.04

FIELDS = [
    "spkid",
    "full_name",
    "pdes",
    "name",
    "kind",
    "neo",
    "pha",
    "class",
    "H",
    "G",
    "diameter",
    "albedo",
    "rot_per",
    "GM",
    "epoch",
    "e",
    "a",
    "q",
    "i",
    "om",
    "w",
    "ma",
    "n",
    "per",
    "ad",
    "moid",
]

QUERY_SLICES = [
    {
        "name": "largest_diameter_asteroids",
        "params": {
            "sb-kind": "a",
            "sb-cdata": json.dumps({"AND": ["diameter|DF"]}, separators=(",", ":")),
            "sort": "-diameter",
            "limit": os.environ.get("SMALL_BODY_LARGE_ASTEROID_LIMIT", "10000"),
        },
    },
    {
        "name": "bright_near_earth_asteroids",
        "params": {
            "sb-kind": "a",
            "sb-group": "neo",
            "sb-cdata": json.dumps({"AND": ["H|DF"]}, separators=(",", ":")),
            "sort": "H",
            "limit": os.environ.get("SMALL_BODY_NEO_LIMIT", "6000"),
        },
    },
    {
        "name": "periodic_and_named_comets",
        "params": {
            "sb-kind": "c",
            "sb-xfrag": "1",
            "sort": "full_name",
            "limit": os.environ.get("SMALL_BODY_COMET_LIMIT", "5000"),
        },
    },
]


def fetch_json(params: dict[str, str]) -> dict[str, Any]:
    query = {
        "fields": ",".join(FIELDS),
        "full-prec": "true",
        **params,
    }
    request = Request(
        f"{SBDB_QUERY_URL}?{urlencode(query)}",
        headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"},
    )
    with urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_spkid: dict[str, dict[str, Any]] = {}
    slice_meta: list[dict[str, Any]] = []

    for query_slice in QUERY_SLICES:
        payload = fetch_json(query_slice["params"])
        fields = [str(field) for field in payload["fields"]]
        count = 0

        for values in payload.get("data", []):
            row = dict(zip(fields, values))
            spkid = str(row.get("spkid") or "").strip()
            if not spkid:
                continue
            existing = by_spkid.get(spkid)
            if existing:
                existing.setdefault("_selection", []).append(query_slice["name"])
            else:
                row["_selection"] = [query_slice["name"]]
                by_spkid[spkid] = row
            count += 1

        slice_meta.append(
            {
                "name": query_slice["name"],
                "params": query_slice["params"],
                "returned_count": count,
                "total_matching_count": payload.get("count"),
            }
        )

    return list(by_spkid.values()), slice_meta


def finite_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def slugify(value: str) -> str:
    normalized = value.strip().lower().replace("+", " plus ")
    normalized = normalized.replace("'", "")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def clean_full_name(value: Any) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or None


def julian_day(dt: datetime) -> float:
    year = dt.year
    month = dt.month
    day = dt.day + (dt.hour + (dt.minute + (dt.second + dt.microsecond / 1_000_000) / 60) / 60) / 24
    if month <= 2:
        year -= 1
        month += 12
    a = year // 100
    b = 2 - a + a // 4
    return math.floor(365.25 * (year + 4716)) + math.floor(30.6001 * (month + 1)) + day + b - 1524.5


def solve_kepler(mean_anomaly_rad: float, eccentricity: float) -> float:
    eccentric_anomaly = mean_anomaly_rad if eccentricity < 0.8 else math.pi
    for _ in range(30):
        delta = (eccentric_anomaly - eccentricity * math.sin(eccentric_anomaly) - mean_anomaly_rad) / (
            1.0 - eccentricity * math.cos(eccentric_anomaly)
        )
        eccentric_anomaly -= delta
        if abs(delta) < 1e-12:
            break
    return eccentric_anomaly


def position_from_elements(row: dict[str, Any], target_jd: float) -> tuple[float, float, float] | None:
    eccentricity = finite_float(row.get("e"))
    semi_major_axis_au = finite_float(row.get("a"))
    perihelion_au = finite_float(row.get("q"))
    epoch_jd = finite_float(row.get("epoch"))
    mean_anomaly_deg = finite_float(row.get("ma"))
    mean_motion_deg_day = finite_float(row.get("n"))
    inclination_deg = finite_float(row.get("i"))
    node_deg = finite_float(row.get("om"))
    peri_deg = finite_float(row.get("w"))

    if semi_major_axis_au is None and perihelion_au is not None and eccentricity is not None and eccentricity < 1:
        semi_major_axis_au = perihelion_au / (1.0 - eccentricity)

    required = [eccentricity, semi_major_axis_au, epoch_jd, mean_anomaly_deg, mean_motion_deg_day, inclination_deg, node_deg, peri_deg]
    if any(value is None for value in required):
        return None
    if eccentricity is None or semi_major_axis_au is None or eccentricity < 0 or eccentricity >= 1 or semi_major_axis_au <= 0:
        return None

    mean_anomaly = math.radians((mean_anomaly_deg or 0.0) + (mean_motion_deg_day or 0.0) * (target_jd - (epoch_jd or target_jd)))
    mean_anomaly = mean_anomaly % (2.0 * math.pi)
    eccentric_anomaly = solve_kepler(mean_anomaly, eccentricity)

    x_orbital = semi_major_axis_au * (math.cos(eccentric_anomaly) - eccentricity)
    y_orbital = semi_major_axis_au * math.sqrt(max(0.0, 1.0 - eccentricity * eccentricity)) * math.sin(eccentric_anomaly)

    node = math.radians(node_deg or 0.0)
    peri = math.radians(peri_deg or 0.0)
    inclination = math.radians(inclination_deg or 0.0)

    cos_node = math.cos(node)
    sin_node = math.sin(node)
    cos_peri = math.cos(peri)
    sin_peri = math.sin(peri)
    cos_i = math.cos(inclination)
    sin_i = math.sin(inclination)

    x = (cos_node * cos_peri - sin_node * sin_peri * cos_i) * x_orbital + (
        -cos_node * sin_peri - sin_node * cos_peri * cos_i
    ) * y_orbital
    y = (sin_node * cos_peri + cos_node * sin_peri * cos_i) * x_orbital + (
        -sin_node * sin_peri + cos_node * cos_peri * cos_i
    ) * y_orbital
    z = (sin_peri * sin_i) * x_orbital + (cos_peri * sin_i) * y_orbital
    return x, y, z


def estimated_diameter_km(row: dict[str, Any], object_type: str) -> float | None:
    diameter = finite_float(row.get("diameter"))
    if diameter is not None and diameter > 0:
        return diameter

    absolute_magnitude = finite_float(row.get("H"))
    if absolute_magnitude is None:
        return None

    albedo = finite_float(row.get("albedo"))
    if albedo is None or albedo <= 0:
        albedo = DEFAULT_COMET_ALBEDO if object_type == "comet" else DEFAULT_ASTEROID_ALBEDO

    diameter = 1329.0 / math.sqrt(albedo) * 10 ** (-absolute_magnitude / 5.0)
    return diameter if math.isfinite(diameter) and diameter > 0 else None


def object_color(row: dict[str, Any], object_type: str) -> str:
    orbit_class = str(row.get("class") or "")
    if object_type == "comet":
        return "#91d5ff"
    if row.get("pha") == "Y":
        return "#f06f61"
    if row.get("neo") == "Y":
        return "#f2a65a"
    if orbit_class in {"TNO", "CEN"}:
        return "#9ec8ff"
    return "#b8a48a"


def object_type_for(row: dict[str, Any]) -> str:
    kind = str(row.get("kind") or "").lower()
    if kind.startswith("c"):
        return "comet"
    return "asteroid"


def aliases_for(row: dict[str, Any], display_name: str) -> list[str]:
    aliases = [display_name]
    for key in ("full_name", "pdes", "name"):
        value = clean_full_name(row.get(key))
        if value:
            aliases.append(value)
    spkid = str(row.get("spkid") or "").strip()
    if spkid:
        aliases.extend([f"JPL SPK-ID {spkid}", f"SPK {spkid}"])

    compacted: list[str] = []
    seen: set[str] = set()
    for alias in aliases:
        normalized = alias.strip()
        normalized_key = normalized.lower()
        if normalized and normalized_key not in seen:
            compacted.append(normalized)
            seen.add(normalized_key)
    return compacted


def build_object(row: dict[str, Any], target_jd: float) -> dict[str, Any] | None:
    position = position_from_elements(row, target_jd)
    if position is None:
        return None

    spkid = str(row.get("spkid") or "").strip()
    if not spkid:
        return None

    object_type = object_type_for(row)
    display_name = str(row.get("name") or "").strip() or clean_full_name(row.get("full_name")) or str(row.get("pdes") or spkid)
    full_name = clean_full_name(row.get("full_name")) or display_name
    diameter_km = estimated_diameter_km(row, object_type)
    radius_km = max(0.0, (diameter_km or 0.0) / 2.0)
    x_au, y_au, z_au = position

    return {
        "key": f"jpl-sbdb-{spkid}",
        "name": display_name,
        "aliases": aliases_for(row, display_name),
        "object_type": object_type,
        "catalog_group": "jpl_small_bodies",
        "source_type": "jpl_sbdb_query",
        "position_model": "jpl_sbdb_two_body_osculating_elements",
        "parent_key": "sun",
        "color": object_color(row, object_type),
        "radius_km": radius_km,
        "x_au": x_au,
        "y_au": y_au,
        "z_au": z_au,
        "x_km": x_au * AU_KM,
        "y_km": y_au * AU_KM,
        "z_km": z_au * AU_KM,
        "absolute_magnitude": finite_float(row.get("H")),
        "external_ids": {
            "jpl_spkid": spkid,
            "primary_designation": str(row.get("pdes") or "").strip() or None,
        },
        "facts": {
            "full_name": full_name,
            "jpl_kind": row.get("kind"),
            "orbit_class": row.get("class"),
            "neo": row.get("neo") == "Y",
            "pha": row.get("pha") == "Y",
            "diameter_km": finite_float(row.get("diameter")),
            "estimated_diameter_km": diameter_km,
            "albedo": finite_float(row.get("albedo")),
            "rotation_period_hours": finite_float(row.get("rot_per")),
            "gm_km3_s2": finite_float(row.get("GM")),
            "h_absolute_magnitude": finite_float(row.get("H")),
            "g_slope_parameter": finite_float(row.get("G")),
            "epoch_jd_tdb": finite_float(row.get("epoch")),
            "position_generated_for_jd_utc": target_jd,
            "eccentricity": finite_float(row.get("e")),
            "semi_major_axis_au": finite_float(row.get("a")),
            "perihelion_au": finite_float(row.get("q")),
            "aphelion_au": finite_float(row.get("ad")),
            "inclination_deg": finite_float(row.get("i")),
            "ascending_node_deg": finite_float(row.get("om")),
            "argument_of_perihelion_deg": finite_float(row.get("w")),
            "mean_anomaly_deg": finite_float(row.get("ma")),
            "mean_motion_deg_day": finite_float(row.get("n")),
            "orbital_period_days": finite_float(row.get("per")),
            "earth_moid_au": finite_float(row.get("moid")),
            "selection_slices": row.get("_selection", []),
        },
        "why_interesting": interesting_note(row, object_type),
    }


def interesting_note(row: dict[str, Any], object_type: str) -> str:
    if object_type == "comet":
        return "Cometary body from the NASA/JPL Small-Body Database."
    if row.get("pha") == "Y":
        return "Potentially hazardous asteroid from the NASA/JPL Small-Body Database."
    if row.get("neo") == "Y":
        return "Near-Earth asteroid from the NASA/JPL Small-Body Database."
    return "Asteroid with orbital elements from the NASA/JPL Small-Body Database."


def reject_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: reject_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [reject_none(item) for item in value if item is not None]
    return value


def main() -> None:
    generated_at = datetime.now(timezone.utc)
    target_jd = julian_day(generated_at)
    rows, slice_meta = fetch_rows()
    objects = [build_object(row, target_jd) for row in rows]
    objects = [reject_none(item) for item in objects if item is not None]
    objects.sort(key=lambda item: (item["object_type"], item.get("absolute_magnitude") is None, item.get("absolute_magnitude") or 99.0, item["name"]))

    payload = {
        "schema_version": 1,
        "generated_at_utc": generated_at.isoformat().replace("+00:00", "Z"),
        "source": {
            "name": "NASA/JPL Small-Body Database Query API",
            "api_url": SBDB_QUERY_URL,
            "documentation_url": SBDB_DOC_URL,
            "filter_documentation_url": SBDB_FILTER_DOC_URL,
            "fields": FIELDS,
            "query_slices": slice_meta,
        },
        "selection": {
            "description": "Union of largest diameter-known asteroids, bright near-Earth asteroids, and non-fragment comets.",
            "position_model": "Two-body propagation from JPL osculating elements to the generation timestamp.",
        },
        "object_count": len(objects),
        "objects": objects,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {payload['object_count']} JPL small bodies to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
