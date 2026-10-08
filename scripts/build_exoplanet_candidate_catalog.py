from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "data" / "catalogs"
OUTPUT_PATH = CATALOG_DIR / "exoplanet_candidates.json"
TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
SOURCE_TABLE = "toi"
SOURCE_LABEL = "NASA Exoplanet Archive TESS Objects of Interest (TOI)"
SOURCE_DOC_URL = "https://exoplanetarchive.ipac.caltech.edu/docs/API_TOI_columns.html"
SCHEMA_VERSION = 1

# TFOPWG dispositions that are candidates. Confirmed (CP) and known (KP)
# planets are in the confirmed catalog; false positives (FP) and false alarms
# (FA) are not planets.
CANDIDATE_DISPOSITIONS = {"PC": "planet_candidate", "APC": "ambiguous_planet_candidate"}

DISPLAY_POSITION = "position"
DISPLAY_ORBIT_ONLY = "orbit_only"
DISPLAY_NONE = "none"

JULIAN_DAY_UNIX_EPOCH = 2_440_587.5
SECONDS_PER_DAY = 86_400.0
DAYS_PER_YEAR = 365.25
# log10 of the nominal solar surface gravity in cm/s^2 (IAU 2015 nominal values).
SOLAR_LOG_G = 4.438
# A mass from log(g) and radius outside these limits is not credible for a
# TESS target star, so the orbit size is then not calculated.
MIN_STELLAR_MASS_SOLAR = 0.05
MAX_STELLAR_MASS_SOLAR = 5.0
# A mass with an uncertainty as large as the mass is not a measurement.
MAX_STELLAR_MASS_RELATIVE_ERROR = 1.0
# TESS gives transit times as barycentric Julian dates in TDB.
TIME_SYSTEM = "BJD-TDB"

QUERY = """
select
  toi,
  toipfx,
  tid,
  ctoi_alias,
  pl_pnum,
  tfopwg_disp,
  ra,
  dec,
  st_dist,
  st_disterr1,
  st_disterr2,
  st_tmag,
  st_teff,
  st_logg,
  st_loggerr1,
  st_loggerr2,
  st_rad,
  st_raderr1,
  st_raderr2,
  pl_tranmid,
  pl_tranmiderr1,
  pl_tranmiderr2,
  pl_tranmidlim,
  pl_orbper,
  pl_orbpererr1,
  pl_orbpererr2,
  pl_orbperlim,
  pl_trandurh,
  pl_trandep,
  pl_rade,
  pl_radeerr1,
  pl_radeerr2,
  pl_radelim,
  pl_insol,
  pl_eqt,
  toi_created,
  rowupdate
from toi
where tfopwg_disp in ('PC', 'APC')
order by toi
""".strip()


def fetch_json(query: str) -> list[dict[str, Any]]:
    url = f"{TAP_URL}?{urlencode({'query': query, 'format': 'json'})}"
    request = Request(url, headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError(f"Unexpected TAP response: {payload!r}")
    return payload


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


def without_nulls(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if value is not None}


def julian_day(moment: datetime) -> float:
    return moment.timestamp() / SECONDS_PER_DAY + JULIAN_DAY_UNIX_EPOCH


def is_measured(row: dict[str, Any], column: str) -> bool:
    """True when the archive gives a value that is not an upper or lower limit."""
    return finite_float(row.get(column)) is not None and not finite_int(row.get(f"{column}lim"))


def measurement(row: dict[str, Any], column: str, key: str) -> dict[str, Any]:
    value = finite_float(row.get(column))
    if value is None:
        return {}
    upper = finite_float(row.get(f"{column}err1"))
    lower = finite_float(row.get(f"{column}err2"))
    return without_nulls(
        {
            key: value,
            f"{key}_err_plus": abs(upper) if upper is not None else None,
            f"{key}_err_minus": abs(lower) if lower is not None else None,
            f"{key}_limit": finite_int(row.get(f"{column}lim")) or None,
        }
    )


def color_for_star(teff_k: float | None) -> str:
    if teff_k is None:
        return "#f0c987"
    if teff_k >= 10_000:
        return "#a9c7ff"
    if teff_k >= 7_500:
        return "#d4e2ff"
    if teff_k >= 6_000:
        return "#fff1c1"
    if teff_k >= 5_200:
        return "#ffd28c"
    if teff_k >= 3_700:
        return "#f4a278"
    return "#f08f6f"


def toi_parts(row: dict[str, Any]) -> tuple[str, str] | None:
    """Splits a TOI number such as "1001.01" into the star part and the candidate part."""
    match = re.fullmatch(r"(\d+)\.(\d+)", str(row.get("toi") or "").strip())
    return (match.group(1), match.group(2)) if match else None


def stellar_mass(row: dict[str, Any]) -> dict[str, float]:
    """
    Star mass from the surface gravity and the radius: M = g R^2 / G.

    The TOI table gives no star mass. The relative uncertainty comes from the
    published uncertainties of log(g) and of the radius, when the table has them.
    """
    log_g = finite_float(row.get("st_logg"))
    radius = finite_float(row.get("st_rad"))
    if log_g is None or radius is None or radius <= 0:
        return {}
    mass = 10 ** (log_g - SOLAR_LOG_G) * radius * radius
    if not MIN_STELLAR_MASS_SOLAR <= mass <= MAX_STELLAR_MASS_SOLAR:
        return {}
    result = {"mass": mass}
    log_g_errors = [abs(error) for error in (finite_float(row.get("st_loggerr1")), finite_float(row.get("st_loggerr2"))) if error is not None]
    radius_errors = [abs(error) for error in (finite_float(row.get("st_raderr1")), finite_float(row.get("st_raderr2"))) if error is not None]
    if log_g_errors and radius_errors:
        result["relative_error"] = math.hypot(math.log(10) * max(log_g_errors), 2 * max(radius_errors) / radius)
        if result["relative_error"] >= MAX_STELLAR_MASS_RELATIVE_ERROR:
            return {}
    return result


def orbit_size(row: dict[str, Any]) -> dict[str, Any]:
    """Orbit size from Kepler's third law. The atlas calculates it; the archive does not give it."""
    period = finite_float(row.get("pl_orbper"))
    mass = stellar_mass(row)
    if not mass or period is None or period <= 0 or not is_measured(row, "pl_orbper"):
        return {}
    semi_major_axis = (mass["mass"] * (period / DAYS_PER_YEAR) ** 2) ** (1 / 3)
    fields: dict[str, Any] = {"semi_major_axis_au": semi_major_axis, "semi_major_axis_atlas_calculated": True}
    if "relative_error" in mass:
        error = semi_major_axis * mass["relative_error"] / 3
        fields["semi_major_axis_au_err_plus"] = error
        fields["semi_major_axis_au_err_minus"] = error
    return fields


def ephemeris(row: dict[str, Any], snapshot_jd: float) -> dict[str, Any]:
    period = finite_float(row.get("pl_orbper"))
    if period is None or period <= 0 or not is_measured(row, "pl_orbper") or not is_measured(row, "pl_tranmid"):
        return {}
    # A measured epoch is not later than the snapshot. One period of margin
    # keeps a predicted next transit and rejects a wrong Julian-day offset.
    if float(row["pl_tranmid"]) > snapshot_jd + period:
        return {}
    return {
        "ephemeris_reference_type": "conjunction",
        "ephemeris_time_system": TIME_SYSTEM,
        "ephemeris_source_table": SOURCE_TABLE,
        **measurement(row, "pl_orbper", "ephemeris_period_days"),
        **measurement(row, "pl_tranmid", "ephemeris_reference_time_jd"),
    }


def display_state(candidate: dict[str, Any]) -> str:
    if candidate.get("semi_major_axis_au") is None:
        return DISPLAY_NONE
    return DISPLAY_POSITION if "ephemeris_reference_type" in candidate else DISPLAY_ORBIT_ONLY


def build_candidate(row: dict[str, Any], snapshot_jd: float) -> dict[str, Any] | None:
    parts = toi_parts(row)
    disposition = CANDIDATE_DISPOSITIONS.get(str(row.get("tfopwg_disp") or "").strip())
    if not parts or not disposition:
        return None
    star_part, candidate_part = parts
    candidate: dict[str, Any] = {
        "key": f"toi-{star_part}-{candidate_part}",
        "name": f"TOI-{star_part}.{candidate_part}",
        "toi": f"{star_part}.{candidate_part}",
        "disposition": disposition,
        "tfopwg_disposition": str(row["tfopwg_disp"]).strip(),
        "community_alias": str(row.get("ctoi_alias") or "").strip() or None,
        "detected_by_transit": True,
        "transit_depth_ppm": finite_float(row.get("pl_trandep")),
        "transit_duration_hours": finite_float(row.get("pl_trandurh")),
        "equilibrium_temperature_k": finite_float(row.get("pl_eqt")),
        "insolation_earth": finite_float(row.get("pl_insol")),
        "toi_created": str(row.get("toi_created") or "").strip()[:10] or None,
        "toi_updated": str(row.get("rowupdate") or "").strip()[:10] or None,
        **measurement(row, "pl_rade", "radius_earth"),
        **measurement(row, "pl_orbper", "period_days"),
        **orbit_size(row),
    }
    if candidate.get("semi_major_axis_au") is not None:
        candidate.update(ephemeris(row, snapshot_jd))
    candidate["orbit_display_state"] = display_state(candidate)
    return without_nulls(candidate)


def has_position(row: dict[str, Any]) -> bool:
    distance = finite_float(row.get("st_dist"))
    return finite_float(row.get("ra")) is not None and finite_float(row.get("dec")) is not None and distance is not None and distance > 0


def build_systems(rows: list[dict[str, Any]], snapshot_time: datetime | None = None) -> list[dict[str, Any]]:
    snapshot_jd = julian_day(snapshot_time or datetime.now(timezone.utc))
    by_star: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        parts = toi_parts(row)
        if parts:
            by_star[parts[0]].append(row)

    systems: list[dict[str, Any]] = []
    for star_part, star_rows in sorted(by_star.items(), key=lambda item: int(item[0])):
        first = star_rows[0]
        # No distance, no place in the atlas: a position is never invented.
        if not has_position(first):
            continue
        candidates = [candidate for candidate in (build_candidate(row, snapshot_jd) for row in star_rows) if candidate]
        if not candidates:
            continue
        tic_id = str(finite_int(first.get("tid")) or "").strip() or None
        mass = stellar_mass(first)
        teff = finite_float(first.get("st_teff"))
        systems.append(
            without_nulls(
                {
                    "key": f"toi-{star_part}",
                    "name": f"TOI-{star_part}",
                    "aliases": [alias for alias in (f"TOI-{star_part}", f"TIC {tic_id}" if tic_id else None) if alias],
                    "tic_id": tic_id,
                    "ra_deg": finite_float(first.get("ra")),
                    "dec_deg": finite_float(first.get("dec")),
                    "distance_pc": finite_float(first.get("st_dist")),
                    "tess_magnitude": finite_float(first.get("st_tmag")),
                    "stellar_teff_k": teff,
                    "stellar_logg": finite_float(first.get("st_logg")),
                    "stellar_radius_solar": finite_float(first.get("st_rad")),
                    "stellar_mass_solar": mass.get("mass"),
                    "stellar_mass_atlas_calculated": True if mass else None,
                    "color": color_for_star(teff),
                    "candidate_count": len(candidates),
                    "candidates": sorted(candidates, key=lambda candidate: candidate["key"]),
                    "why_interesting": "A star with a TESS planet candidate that is not confirmed.",
                }
            )
        )
    return systems


def coverage(rows: list[dict[str, Any]], systems: list[dict[str, Any]]) -> dict[str, Any]:
    candidates = [candidate for system in systems for candidate in system["candidates"]]
    return {
        "source_rows": len(rows),
        "excluded_no_distance": sum(1 for row in rows if not has_position(row)),
        "disposition": dict(sorted(Counter(candidate["disposition"] for candidate in candidates).items())),
        "orbit_display_state": dict(sorted(Counter(candidate["orbit_display_state"] for candidate in candidates).items())),
    }


def build_payload(rows: list[dict[str, Any]]) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc)
    systems = build_systems(rows, generated_at)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at_utc": generated_at.isoformat().replace("+00:00", "Z"),
        # The importer copies `source` to each catalog row and each API
        # response. The long query text stays out of it for that reason.
        "source": {
            "name": SOURCE_LABEL,
            "table": SOURCE_TABLE,
            "tap_url": TAP_URL,
            "documentation_url": SOURCE_DOC_URL,
            "dispositions": sorted(CANDIDATE_DISPOSITIONS),
        },
        "queries": {SOURCE_TABLE: QUERY},
        "candidate_count": sum(system["candidate_count"] for system in systems),
        "system_count": len(systems),
        "coverage": coverage(rows, systems),
        "systems": systems,
    }


def main() -> None:
    payload = build_payload(fetch_json(QUERY))
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {payload['system_count']} stars with {payload['candidate_count']} planet candidates to {OUTPUT_PATH}")
    print(f"Coverage: {json.dumps(payload['coverage'], sort_keys=True)}")
    print(f"File size: {OUTPUT_PATH.stat().st_size} bytes")


if __name__ == "__main__":
    main()
