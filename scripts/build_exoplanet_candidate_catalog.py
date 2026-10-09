from __future__ import annotations

import html
import json
import math
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "data" / "catalogs"
OUTPUT_PATH = CATALOG_DIR / "exoplanet_candidates.json"
ARCHIVE_URL = "https://exoplanetarchive.ipac.caltech.edu/"
TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
VIZIER_TAP_URL = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
SCHEMA_VERSION = 2
USER_AGENT = "CosmicAtlasCatalogBuilder/1.0"
# The archive refuses a burst of queries, so the builder waits between them.
QUERY_PAUSE_SECONDS = 6
VIZIER_BATCH_SIZE = 500

CATALOG_TOI = "toi"
CATALOG_KOI = "koi"
CATALOG_K2 = "k2"
CATALOG_COMMUNITY = "community"

# The importer copies one of these blocks to each catalog row and each API
# response. The long query text stays out of them for that reason.
SOURCES: dict[str, dict[str, Any]] = {
    CATALOG_TOI: {
        "name": "NASA Exoplanet Archive TESS Objects of Interest (TOI)",
        "table": "toi",
        "tap_url": TAP_URL,
        "documentation_url": "https://exoplanetarchive.ipac.caltech.edu/docs/API_TOI_columns.html",
        "dispositions": ["APC", "PC"],
    },
    CATALOG_KOI: {
        "name": "NASA Exoplanet Archive Kepler Objects of Interest (cumulative table)",
        "table": "cumulative",
        "tap_url": TAP_URL,
        "documentation_url": "https://exoplanetarchive.ipac.caltech.edu/docs/API_kepcandidate_columns.html",
        "dispositions": ["CANDIDATE"],
        "distance_source": "Berger et al. 2020, Gaia-Kepler Stellar Properties Catalog (VizieR J/AJ/159/280)",
        "distance_url": "https://doi.org/10.3847/1538-3881/159/6/280",
    },
    CATALOG_K2: {
        "name": "NASA Exoplanet Archive K2 Planets and Candidates",
        "table": "k2pandc",
        "tap_url": TAP_URL,
        "documentation_url": "https://exoplanetarchive.ipac.caltech.edu/docs/API_k2pandc_columns.html",
        "dispositions": ["CANDIDATE"],
    },
    CATALOG_COMMUNITY: {
        "name": "Community reports with a public record",
        "note": "No mission team reviewed these reports. Each record names its report.",
    },
}
SOURCE_LABELS = {
    CATALOG_TOI: "TESS Objects of Interest",
    CATALOG_KOI: "Kepler Objects of Interest",
    CATALOG_K2: "K2 Planets and Candidates",
}

# TFOPWG dispositions that are candidates. Confirmed (CP) and known (KP)
# planets are in the confirmed catalog; false positives (FP) and false alarms
# (FA) are not planets.
CANDIDATE_DISPOSITIONS = {"PC": "planet_candidate", "APC": "ambiguous_planet_candidate"}
ARCHIVE_CANDIDATE = "CANDIDATE"
COMMUNITY_DISPOSITION = "community_report"

DISPLAY_POSITION = "position"
DISPLAY_ORBIT_ONLY = "orbit_only"
DISPLAY_NONE = "none"

JULIAN_DAY_UNIX_EPOCH = 2_440_587.5
SECONDS_PER_DAY = 86_400.0
DAYS_PER_YEAR = 365.25
# log10 of the nominal solar surface gravity in cm/s^2 (IAU 2015 nominal values).
SOLAR_LOG_G = 4.438
# A star mass outside these limits is not credible for a transit survey
# target, so the orbit size is then not calculated.
MIN_STELLAR_MASS_SOLAR = 0.05
MAX_STELLAR_MASS_SOLAR = 5.0
# A mass with an uncertainty as large as the mass is not a measurement.
MAX_STELLAR_MASS_RELATIVE_ERROR = 1.0
# TESS and Kepler give transit times as barycentric Julian dates in TDB.
TIME_SYSTEM = "BJD-TDB"
PERCENT_TO_PPM = 10_000.0

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

# The confirmed rows give the confirmed-host name of a star ("Kepler-11") for
# a candidate of the same star.
KOI_QUERY = """
select
  kepoi_name,
  kepler_name,
  kepid,
  koi_disposition,
  koi_score,
  koi_period,
  koi_period_err1,
  koi_period_err2,
  koi_time0,
  koi_time0_err1,
  koi_time0_err2,
  koi_sma,
  koi_incl,
  koi_prad,
  koi_prad_err1,
  koi_prad_err2,
  koi_teq,
  koi_insol,
  koi_depth,
  koi_duration,
  koi_steff,
  koi_slogg,
  koi_srad,
  koi_smass,
  koi_kepmag,
  ra,
  dec
from cumulative
where koi_disposition in ('CANDIDATE', 'CONFIRMED')
order by kepoi_name
""".strip()

K2_QUERY = """
select
  pl_name,
  hostname,
  epic_hostname,
  epic_candname,
  tic_id,
  gaia_dr3_id,
  hd_name,
  hip_name,
  disposition,
  disp_refname,
  pl_refname,
  pl_orbper,
  pl_orbpererr1,
  pl_orbpererr2,
  pl_orbperlim,
  pl_orbsmax,
  pl_orbsmaxerr1,
  pl_orbsmaxerr2,
  pl_orbsmaxlim,
  pl_tranmid,
  pl_tranmiderr1,
  pl_tranmiderr2,
  pl_tranmidlim,
  pl_tsystemref,
  pl_rade,
  pl_radeerr1,
  pl_radeerr2,
  pl_radelim,
  pl_trandep,
  pl_trandur,
  pl_eqt,
  pl_insol,
  st_teff,
  st_rad,
  st_raderr1,
  st_raderr2,
  st_mass,
  st_masserr1,
  st_masserr2,
  st_logg,
  st_loggerr1,
  st_loggerr2,
  sy_dist,
  ra,
  dec
from k2pandc
where disposition = 'CANDIDATE'
  and default_flag = 1
order by pl_name
""".strip()

# Star distances for the Kepler field. The KOI table gives none.
KOI_DISTANCE_QUERY = 'SELECT KIC, Dist, "E_Dist", "e_Dist" FROM "J/AJ/159/280/table2" WHERE KIC IN ({ids})'

REFERENCE_LINK = re.compile(r"<a\b[^>]*?\brefstr=([^\s>]+)[^>]*?\bhref=([^\s>]+)[^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL)

# Reports of candidates that are in no archive table. A report goes in this
# list only with a public, citable record and a published ephemeris. The values
# are those of the report; the builder calculates the orbit size, as it does
# for the archive tables. The coordinates are the Gaia DR3 values of the star.
COMMUNITY_REPORTS: list[dict[str, Any]] = [
    {
        "key": "tic-4206066",
        "name": "TIC 4206066",
        "aliases": ["TIC 4206066", "StKM 1-561", "Gaia DR3 3220388198192519424"],
        "tic_id": "4206066",
        "ra_deg": 80.85982665567226,
        "dec_deg": -1.3269640103386409,
        "distance_pc": 35.6,
        "stellar_radius_solar": 0.623,
        "stellar_mass_solar": 0.606,
        "stellar_mass_solar_err": 0.015,
        "color": "#f4a278",
        "report": {
            "label": "Rabtsevich 2026, preprint, not peer reviewed",
            "url": "https://doi.org/10.5281/zenodo.22967456",
        },
        "candidates": [
            {
                "key": "tic-4206066-3-18d",
                "name": "TIC 4206066 3.18 d signal",
                "period_days": 3.182785,
                "period_days_err": 0.000006,
                "transit_time_bjd_tdb": 2460998.736,
                "transit_time_err": 0.003,
                "transit_depth_ppm": 500.0,
                "radius_earth": 1.4,
                "radius_earth_err": 0.1,
                "candidate_note": (
                    "Reported from TESS Sectors 6, 32, and 98 (23 transits). The report claims no statistical validation. "
                    "The radius applies if the signal is on this star; an unresolved bound companion is the main alternative host."
                ),
            },
            {
                "key": "tic-4206066-11-13d",
                "name": "TIC 4206066 11.13 d signal",
                "period_days": 11.13274,
                "period_days_err": 0.00003,
                "transit_time_bjd_tdb": 2461000.865,
                "transit_time_err": 0.003,
                "transit_depth_ppm": 1000.0,
                "radius_earth": 2.2,
                "candidate_note": (
                    "Tentative signal: approximately 3 sigma in a post hoc test, with a tentative ephemeris. "
                    "The report claims no statistical validation."
                ),
            },
        ],
    },
]


def fetch_json(query: str) -> list[dict[str, Any]]:
    url = f"{TAP_URL}?{urlencode({'query': query, 'format': 'json'})}"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=240) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError(f"Unexpected TAP response: {payload!r}")
    return payload


def fetch_vizier(query: str) -> list[list[Any]]:
    data = urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query}).encode("utf-8")
    request = Request(VIZIER_TAP_URL, data=data, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=240) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["data"]


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


def text(value: Any) -> str | None:
    return str(value).strip() or None if value is not None else None


def without_nulls(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if value is not None}


def julian_day(moment: datetime) -> float:
    return moment.timestamp() / SECONDS_PER_DAY + JULIAN_DAY_UNIX_EPOCH


def is_measured(row: dict[str, Any], column: str) -> bool:
    """True when the archive gives a value that is not an upper or lower limit."""
    return finite_float(row.get(column)) is not None and not finite_int(row.get(f"{column}lim"))


def measurement(row: dict[str, Any], column: str, key: str, separator: str = "") -> dict[str, Any]:
    """A value with its uncertainties and limit flag. The KOI table puts "_" before "err1"."""
    value = finite_float(row.get(column))
    if value is None:
        return {}
    upper = finite_float(row.get(f"{column}{separator}err1"))
    lower = finite_float(row.get(f"{column}{separator}err2"))
    return without_nulls(
        {
            key: value,
            f"{key}_err_plus": abs(upper) if upper is not None else None,
            f"{key}_err_minus": abs(lower) if lower is not None else None,
            f"{key}_limit": finite_int(row.get(f"{column}lim")) or None,
        }
    )


def symmetric(key: str, value: float | None, error: float | None) -> dict[str, Any]:
    return without_nulls({key: value, f"{key}_err_plus": error, f"{key}_err_minus": error}) if value is not None else {}


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


def parse_reference(value: Any) -> dict[str, str] | None:
    """Reads one archive reference anchor into its label and absolute link."""
    match = REFERENCE_LINK.search(str(value or ""))
    if not match:
        return None
    label = re.sub(r"\s+", " ", html.unescape(match.group(3))).strip()
    return {"label": label, "url": urljoin(ARCHIVE_URL, html.unescape(match.group(2)))} if label else None


def credible_mass(mass: float | None, relative_error: float | None) -> dict[str, float]:
    if mass is None or not MIN_STELLAR_MASS_SOLAR <= mass <= MAX_STELLAR_MASS_SOLAR:
        return {}
    if relative_error is not None and relative_error >= MAX_STELLAR_MASS_RELATIVE_ERROR:
        return {}
    return without_nulls({"mass": mass, "relative_error": relative_error})


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
    log_g_errors = [abs(error) for error in (finite_float(row.get("st_loggerr1")), finite_float(row.get("st_loggerr2"))) if error is not None]
    radius_errors = [abs(error) for error in (finite_float(row.get("st_raderr1")), finite_float(row.get("st_raderr2"))) if error is not None]
    relative_error = math.hypot(math.log(10) * max(log_g_errors), 2 * max(radius_errors) / radius) if log_g_errors and radius_errors else None
    return credible_mass(10 ** (log_g - SOLAR_LOG_G) * radius * radius, relative_error)


def published_mass(row: dict[str, Any]) -> dict[str, float]:
    """Star mass that the row gives, with the larger of its two uncertainties."""
    mass = finite_float(row.get("st_mass"))
    errors = [abs(error) for error in (finite_float(row.get("st_masserr1")), finite_float(row.get("st_masserr2"))) if error is not None]
    return credible_mass(mass, max(errors) / mass if errors and mass else None) if mass and mass > 0 else {}


def kepler_orbit(mass: dict[str, float], period: float | None) -> dict[str, Any]:
    """Orbit size from Kepler's third law. The atlas calculates it; the source does not give it."""
    if not mass or period is None or period <= 0:
        return {}
    semi_major_axis = (mass["mass"] * (period / DAYS_PER_YEAR) ** 2) ** (1 / 3)
    error = semi_major_axis * mass["relative_error"] / 3 if "relative_error" in mass else None
    return {**symmetric("semi_major_axis_au", semi_major_axis, error), "semi_major_axis_atlas_calculated": True}


def orbit_size(row: dict[str, Any]) -> dict[str, Any]:
    """Orbit size of a TOI row, from the period and the star mass that the atlas calculates."""
    return kepler_orbit(stellar_mass(row), finite_float(row.get("pl_orbper"))) if is_measured(row, "pl_orbper") else {}


def ephemeris(period: dict[str, Any], transit_time: dict[str, Any], table: str, time_system: str, snapshot_jd: float) -> dict[str, Any]:
    """Conjunction ephemeris from a measured period and a measured transit midpoint."""
    period_days = period.get("ephemeris_period_days")
    reference = transit_time.get("ephemeris_reference_time_jd")
    if period_days is None or period_days <= 0 or reference is None:
        return {}
    if "ephemeris_period_days_limit" in period or "ephemeris_reference_time_jd_limit" in transit_time:
        return {}
    # A measured epoch is not later than the snapshot. One period of margin
    # keeps a predicted next transit and rejects a wrong Julian-day offset.
    if reference > snapshot_jd + period_days:
        return {}
    return {
        "ephemeris_reference_type": "conjunction",
        "ephemeris_time_system": time_system,
        "ephemeris_source_table": table,
        **period,
        **transit_time,
    }


def finish_candidate(candidate: dict[str, Any], timing: dict[str, Any]) -> dict[str, Any]:
    """Adds the timing to a candidate with an orbit size and sets its display state."""
    if candidate.get("semi_major_axis_au") is None:
        candidate["orbit_display_state"] = DISPLAY_NONE
    else:
        candidate.update(timing)
        candidate["orbit_display_state"] = DISPLAY_POSITION if timing else DISPLAY_ORBIT_ONLY
    return without_nulls(candidate)


def star_record(catalog: str, fields: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    fields = without_nulls(fields)
    return {
        **fields,
        "catalog": catalog,
        "aliases": list(dict.fromkeys(alias for alias in fields.get("aliases", []) if alias)),
        "host_identifiers": list(dict.fromkeys(name for name in fields.get("host_identifiers", []) if name)),
        "color": fields.get("color") or color_for_star(fields.get("stellar_teff_k")),
        "candidate_count": len(candidates),
        "candidates": sorted(candidates, key=lambda candidate: candidate["key"]),
    }


def has_position(row: dict[str, Any], distance_column: str = "st_dist") -> bool:
    distance = finite_float(row.get(distance_column))
    return finite_float(row.get("ra")) is not None and finite_float(row.get("dec")) is not None and distance is not None and distance > 0


# TESS Objects of Interest


def toi_parts(row: dict[str, Any]) -> tuple[str, str] | None:
    """Splits a TOI number such as "1001.01" into the star part and the candidate part."""
    match = re.fullmatch(r"(\d+)\.(\d+)", str(row.get("toi") or "").strip())
    return (match.group(1), match.group(2)) if match else None


def build_toi_candidate(row: dict[str, Any], snapshot_jd: float) -> dict[str, Any] | None:
    parts = toi_parts(row)
    disposition = CANDIDATE_DISPOSITIONS.get(str(row.get("tfopwg_disp") or "").strip())
    if not parts or not disposition:
        return None
    star_part, candidate_part = parts
    code = str(row["tfopwg_disp"]).strip()
    candidate: dict[str, Any] = {
        "key": f"toi-{star_part}-{candidate_part}",
        "name": f"TOI-{star_part}.{candidate_part}",
        "aliases": [f"TOI {star_part}.{candidate_part}"],
        "toi": f"{star_part}.{candidate_part}",
        "source_catalog": SOURCE_LABELS[CATALOG_TOI],
        "disposition": disposition,
        "disposition_source": f"TFOPWG disposition {code}",
        "tfopwg_disposition": code,
        "community_alias": text(row.get("ctoi_alias")),
        "detected_by_transit": True,
        "transit_depth_ppm": finite_float(row.get("pl_trandep")),
        "transit_duration_hours": finite_float(row.get("pl_trandurh")),
        "equilibrium_temperature_k": finite_float(row.get("pl_eqt")),
        "insolation_earth": finite_float(row.get("pl_insol")),
        "toi_created": (text(row.get("toi_created")) or "")[:10] or None,
        "toi_updated": (text(row.get("rowupdate")) or "")[:10] or None,
        **measurement(row, "pl_rade", "radius_earth"),
        **measurement(row, "pl_orbper", "period_days"),
        **orbit_size(row),
    }
    timing = ephemeris(
        measurement(row, "pl_orbper", "ephemeris_period_days"),
        measurement(row, "pl_tranmid", "ephemeris_reference_time_jd"),
        SOURCES[CATALOG_TOI]["table"],
        TIME_SYSTEM,
        snapshot_jd,
    )
    return finish_candidate(candidate, timing)


def build_toi_systems(rows: list[dict[str, Any]], snapshot_time: datetime | None = None) -> list[dict[str, Any]]:
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
        candidates = [candidate for candidate in (build_toi_candidate(row, snapshot_jd) for row in star_rows) if candidate]
        if not candidates:
            continue
        tic_id = str(finite_int(first.get("tid")) or "").strip() or None
        tic_name = f"TIC {tic_id}" if tic_id else None
        mass = stellar_mass(first)
        systems.append(
            star_record(
                CATALOG_TOI,
                {
                    "key": f"toi-{star_part}",
                    "name": f"TOI-{star_part}",
                    "aliases": [f"TOI-{star_part}", tic_name],
                    "host_identifiers": [tic_name],
                    "tic_id": tic_id,
                    "ra_deg": finite_float(first.get("ra")),
                    "dec_deg": finite_float(first.get("dec")),
                    "distance_pc": finite_float(first.get("st_dist")),
                    "tess_magnitude": finite_float(first.get("st_tmag")),
                    "stellar_teff_k": finite_float(first.get("st_teff")),
                    "stellar_logg": finite_float(first.get("st_logg")),
                    "stellar_radius_solar": finite_float(first.get("st_rad")),
                    "stellar_mass_solar": mass.get("mass"),
                    "stellar_mass_atlas_calculated": True if mass else None,
                    "why_interesting": "A star with a TESS planet candidate that is not confirmed.",
                },
                candidates,
            )
        )
    return systems


# Kepler Objects of Interest


def koi_parts(row: dict[str, Any]) -> tuple[str, str] | None:
    """Splits a KOI name such as "K00753.01" into the star number and the candidate number."""
    match = re.fullmatch(r"K0*(\d+)\.(\d+)", str(row.get("kepoi_name") or "").strip())
    return (match.group(1), match.group(2)) if match else None


def fetch_koi_distances(
    kic_ids: list[int],
    fetch: Callable[[str], list[list[Any]]] = fetch_vizier,
    batch_size: int = VIZIER_BATCH_SIZE,
) -> dict[int, dict[str, float]]:
    """Distances of Kepler stars from Berger et al. (2020), by exact KIC number."""
    ids = sorted({int(kic_id) for kic_id in kic_ids})
    distances: dict[int, dict[str, float]] = {}
    for start in range(0, len(ids), batch_size):
        batch = ids[start : start + batch_size]
        for kic_id, distance, upper, lower in fetch(KOI_DISTANCE_QUERY.format(ids=",".join(str(kic_id) for kic_id in batch))):
            value = finite_float(distance)
            if value is not None and value > 0:
                distances[int(kic_id)] = without_nulls(
                    {"distance_pc": value, "distance_pc_err_plus": abs_or_none(upper), "distance_pc_err_minus": abs_or_none(lower)}
                )
    return distances


def abs_or_none(value: Any) -> float | None:
    number = finite_float(value)
    return abs(number) if number is not None else None


def build_koi_candidate(row: dict[str, Any], snapshot_jd: float) -> dict[str, Any] | None:
    parts = koi_parts(row)
    if not parts or text(row.get("koi_disposition")) != ARCHIVE_CANDIDATE:
        return None
    star_part, candidate_part = parts
    orbit_size_au = finite_float(row.get("koi_sma"))
    candidate: dict[str, Any] = {
        "key": f"koi-{star_part}-{candidate_part}",
        "name": f"KOI-{star_part}.{candidate_part}",
        "aliases": [f"KOI {star_part}.{candidate_part}", str(row["kepoi_name"]).strip()],
        "source_catalog": SOURCE_LABELS[CATALOG_KOI],
        "disposition": "planet_candidate",
        "disposition_source": "Kepler KOI disposition CANDIDATE",
        "disposition_score": finite_float(row.get("koi_score")),
        "detected_by_transit": True,
        "transit_depth_ppm": finite_float(row.get("koi_depth")),
        "transit_duration_hours": finite_float(row.get("koi_duration")),
        "equilibrium_temperature_k": finite_float(row.get("koi_teq")),
        "insolation_earth": finite_float(row.get("koi_insol")),
        "inclination_deg": finite_float(row.get("koi_incl")),
        **measurement(row, "koi_prad", "radius_earth", "_"),
        **measurement(row, "koi_period", "period_days", "_"),
    }
    if orbit_size_au is not None and orbit_size_au > 0:
        # The Kepler pipeline calculates this value from the period and its star mass.
        candidate.update({"semi_major_axis_au": orbit_size_au, "semi_major_axis_calculated": True})
    timing = ephemeris(
        measurement(row, "koi_period", "ephemeris_period_days", "_"),
        measurement(row, "koi_time0", "ephemeris_reference_time_jd", "_"),
        SOURCES[CATALOG_KOI]["table"],
        TIME_SYSTEM,
        snapshot_jd,
    )
    return finish_candidate(candidate, timing)


def build_koi_systems(
    rows: list[dict[str, Any]],
    distances: dict[int, dict[str, float]],
    snapshot_time: datetime | None = None,
) -> list[dict[str, Any]]:
    snapshot_jd = julian_day(snapshot_time or datetime.now(timezone.utc))
    by_star: dict[int, list[dict[str, Any]]] = defaultdict(list)
    confirmed_names: dict[int, list[str]] = defaultdict(list)
    for row in rows:
        kic_id = finite_int(row.get("kepid"))
        if kic_id is None:
            continue
        if text(row.get("koi_disposition")) == ARCHIVE_CANDIDATE:
            by_star[kic_id].append(row)
        elif text(row.get("kepler_name")):
            # "Kepler-11 b" is a planet of the confirmed host "Kepler-11".
            confirmed_names[kic_id].append(re.sub(r"\s+[a-z]$", "", str(row["kepler_name"]).strip()))

    systems: list[dict[str, Any]] = []
    for kic_id, star_rows in by_star.items():
        first = star_rows[0]
        distance = distances.get(kic_id)
        parts = koi_parts(first)
        if not parts or not distance or finite_float(first.get("ra")) is None or finite_float(first.get("dec")) is None:
            continue
        candidates = [candidate for candidate in (build_koi_candidate(row, snapshot_jd) for row in star_rows) if candidate]
        if not candidates:
            continue
        star_name = f"KOI-{parts[0]}"
        systems.append(
            star_record(
                CATALOG_KOI,
                {
                    "key": f"koi-{parts[0]}",
                    "name": star_name,
                    "aliases": [star_name, f"KIC {kic_id}"],
                    "host_identifiers": [*confirmed_names.get(kic_id, []), star_name, f"KIC {kic_id}"],
                    "kic_id": str(kic_id),
                    "ra_deg": finite_float(first.get("ra")),
                    "dec_deg": finite_float(first.get("dec")),
                    **distance,
                    "distance_source": "Berger et al. 2020",
                    "kepler_magnitude": finite_float(first.get("koi_kepmag")),
                    "stellar_teff_k": finite_float(first.get("koi_steff")),
                    "stellar_logg": finite_float(first.get("koi_slogg")),
                    "stellar_radius_solar": finite_float(first.get("koi_srad")),
                    "stellar_mass_solar": finite_float(first.get("koi_smass")),
                    "why_interesting": "A star with a Kepler planet candidate that is not confirmed.",
                },
                candidates,
            )
        )
    return sorted(systems, key=lambda system: int(system["key"][4:]))


# K2 Planets and Candidates


def k2_parts(row: dict[str, Any]) -> tuple[str, str] | None:
    """Splits a K2 candidate name such as "EPIC 206135682.04" into the EPIC number and the candidate number."""
    match = re.fullmatch(r"EPIC\s+(\d+)\.(\d+)", str(row.get("epic_candname") or "").strip())
    return (match.group(1), match.group(2)) if match else None


def k2_orbit_size(row: dict[str, Any]) -> dict[str, Any]:
    """The published orbit size, else the size from the period and the star mass of the same row."""
    if is_measured(row, "pl_orbsmax") and float(row["pl_orbsmax"]) > 0:
        return measurement(row, "pl_orbsmax", "semi_major_axis_au")
    if not is_measured(row, "pl_orbper"):
        return {}
    return kepler_orbit(published_mass(row) or stellar_mass(row), finite_float(row.get("pl_orbper")))


def build_k2_candidate(row: dict[str, Any], snapshot_jd: float) -> dict[str, Any] | None:
    parts = k2_parts(row)
    if not parts or text(row.get("disposition")) != ARCHIVE_CANDIDATE:
        return None
    epic_id, candidate_part = parts
    name = f"EPIC {epic_id}.{candidate_part}"
    depth_percent = finite_float(row.get("pl_trandep"))
    reference = parse_reference(row.get("pl_refname"))
    quantities = [quantity for quantity, column in (("period", "pl_orbper"), ("semi_major_axis", "pl_orbsmax"), ("radius", "pl_rade")) if finite_float(row.get(column)) is not None]
    candidate: dict[str, Any] = {
        "key": f"epic-{epic_id}-{candidate_part}",
        "name": name,
        "aliases": [alias for alias in (text(row.get("pl_name")),) if alias and alias != name] or None,
        "source_catalog": SOURCE_LABELS[CATALOG_K2],
        "disposition": "planet_candidate",
        "disposition_source": ", ".join(part for part in ("K2 disposition CANDIDATE", text(row.get("disp_refname"))) if part),
        "detected_by_transit": True,
        "transit_depth_ppm": round(depth_percent * PERCENT_TO_PPM, 3) if depth_percent is not None else None,
        "transit_duration_hours": finite_float(row.get("pl_trandur")),
        "equilibrium_temperature_k": finite_float(row.get("pl_eqt")),
        "insolation_earth": finite_float(row.get("pl_insol")),
        "references": [{**reference, "quantities": quantities}] if reference else None,
        **measurement(row, "pl_rade", "radius_earth"),
        **measurement(row, "pl_orbper", "period_days"),
        **k2_orbit_size(row),
    }
    timing = ephemeris(
        measurement(row, "pl_orbper", "ephemeris_period_days"),
        measurement(row, "pl_tranmid", "ephemeris_reference_time_jd"),
        SOURCES[CATALOG_K2]["table"],
        text(row.get("pl_tsystemref")) or "BJD",
        snapshot_jd,
    )
    return finish_candidate(candidate, timing)


def build_k2_systems(rows: list[dict[str, Any]], snapshot_time: datetime | None = None) -> list[dict[str, Any]]:
    snapshot_jd = julian_day(snapshot_time or datetime.now(timezone.utc))
    by_star: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        parts = k2_parts(row)
        if parts:
            by_star[parts[0]].append(row)

    systems: list[dict[str, Any]] = []
    for epic_id, star_rows in sorted(by_star.items(), key=lambda item: int(item[0])):
        first = star_rows[0]
        if not has_position(first, "sy_dist"):
            continue
        candidates = [candidate for candidate in (build_k2_candidate(row, snapshot_jd) for row in star_rows) if candidate]
        if not candidates:
            continue
        star_name = f"EPIC {epic_id}"
        names = [text(first.get(column)) for column in ("hostname", "tic_id", "hd_name", "hip_name")]
        mass = published_mass(first)
        calculated_mass = {} if mass else stellar_mass(first)
        systems.append(
            star_record(
                CATALOG_K2,
                {
                    "key": f"epic-{epic_id}",
                    "name": star_name,
                    "aliases": [star_name, *names, text(first.get("gaia_dr3_id"))],
                    "host_identifiers": [*names, star_name, text(first.get("gaia_dr3_id"))],
                    "epic_id": epic_id,
                    "tic_id": (text(first.get("tic_id")) or "").removeprefix("TIC ").strip() or None,
                    "ra_deg": finite_float(first.get("ra")),
                    "dec_deg": finite_float(first.get("dec")),
                    "distance_pc": finite_float(first.get("sy_dist")),
                    "stellar_teff_k": finite_float(first.get("st_teff")),
                    "stellar_logg": finite_float(first.get("st_logg")),
                    "stellar_radius_solar": finite_float(first.get("st_rad")),
                    "stellar_mass_solar": (mass or calculated_mass).get("mass"),
                    "stellar_mass_atlas_calculated": True if calculated_mass else None,
                    "why_interesting": "A star with a K2 planet candidate that is not confirmed.",
                },
                candidates,
            )
        )
    return systems


# Community reports


def build_community_systems(reports: list[dict[str, Any]], snapshot_time: datetime | None = None) -> list[dict[str, Any]]:
    snapshot_jd = julian_day(snapshot_time or datetime.now(timezone.utc))
    systems: list[dict[str, Any]] = []
    for report in reports:
        reference = report["report"]
        mass = credible_mass(report.get("stellar_mass_solar"), relative(report.get("stellar_mass_solar_err"), report.get("stellar_mass_solar")))
        candidates = []
        for signal in report["candidates"]:
            period = signal.get("period_days")
            candidate: dict[str, Any] = {
                "key": signal["key"],
                "name": signal["name"],
                "source_catalog": f"community report: {reference['label']}",
                "disposition": COMMUNITY_DISPOSITION,
                "disposition_source": reference["label"],
                "candidate_note": signal.get("candidate_note"),
                "detected_by_transit": True,
                "transit_depth_ppm": signal.get("transit_depth_ppm"),
                "references": [{**reference, "quantities": ["period", "radius"]}],
                **symmetric("radius_earth", signal.get("radius_earth"), signal.get("radius_earth_err")),
                **symmetric("period_days", period, signal.get("period_days_err")),
                **kepler_orbit(mass, period),
            }
            timing = ephemeris(
                symmetric("ephemeris_period_days", period, signal.get("period_days_err")),
                symmetric("ephemeris_reference_time_jd", signal.get("transit_time_bjd_tdb"), signal.get("transit_time_err")),
                "community_report",
                TIME_SYSTEM,
                snapshot_jd,
            )
            candidates.append(finish_candidate(candidate, timing))
        tic_name = f"TIC {report['tic_id']}" if report.get("tic_id") else None
        systems.append(
            star_record(
                CATALOG_COMMUNITY,
                {
                    **{key: value for key, value in report.items() if key not in {"candidates", "report", "stellar_mass_solar_err"}},
                    "host_identifiers": [tic_name],
                    "report_label": reference["label"],
                    "report_url": reference["url"],
                    "why_interesting": "A star with a planet candidate from a community report. No mission team reviewed the report.",
                },
                candidates,
            )
        )
    return systems


def relative(error: float | None, value: float | None) -> float | None:
    return abs(error) / value if error is not None and value else None


def catalog_coverage(source_rows: int, systems: list[dict[str, Any]]) -> dict[str, Any]:
    candidates = [candidate for system in systems for candidate in system["candidates"]]
    return {
        "source_rows": source_rows,
        "excluded_no_distance": source_rows - len(candidates),
        "stars": len(systems),
        "candidates": len(candidates),
        "disposition": dict(sorted(Counter(candidate["disposition"] for candidate in candidates).items())),
        "orbit_display_state": dict(sorted(Counter(candidate["orbit_display_state"] for candidate in candidates).items())),
    }


def build_payload(
    toi_rows: list[dict[str, Any]],
    koi_rows: list[dict[str, Any]],
    koi_distances: dict[int, dict[str, float]],
    k2_rows: list[dict[str, Any]],
    reports: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc)
    reports = COMMUNITY_REPORTS if reports is None else reports
    by_catalog = {
        CATALOG_TOI: build_toi_systems(toi_rows, generated_at),
        CATALOG_KOI: build_koi_systems(koi_rows, koi_distances, generated_at),
        CATALOG_K2: build_k2_systems(k2_rows, generated_at),
        CATALOG_COMMUNITY: build_community_systems(reports, generated_at),
    }
    source_rows = {
        CATALOG_TOI: len(toi_rows),
        CATALOG_KOI: sum(1 for row in koi_rows if text(row.get("koi_disposition")) == ARCHIVE_CANDIDATE),
        CATALOG_K2: len(k2_rows),
        CATALOG_COMMUNITY: sum(len(report["candidates"]) for report in reports),
    }
    systems = [system for catalog_systems in by_catalog.values() for system in catalog_systems]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at_utc": generated_at.isoformat().replace("+00:00", "Z"),
        "sources": SOURCES,
        "queries": {"toi": QUERY, "cumulative": KOI_QUERY, "k2pandc": K2_QUERY, "koi_distance": KOI_DISTANCE_QUERY},
        "candidate_count": sum(system["candidate_count"] for system in systems),
        "system_count": len(systems),
        "coverage": {catalog: catalog_coverage(source_rows[catalog], catalog_systems) for catalog, catalog_systems in by_catalog.items()},
        "systems": systems,
    }


def main() -> None:
    toi_rows = fetch_json(QUERY)
    time.sleep(QUERY_PAUSE_SECONDS)
    koi_rows = fetch_json(KOI_QUERY)
    time.sleep(QUERY_PAUSE_SECONDS)
    k2_rows = fetch_json(K2_QUERY)
    candidate_stars = [row["kepid"] for row in koi_rows if text(row.get("koi_disposition")) == ARCHIVE_CANDIDATE and finite_int(row.get("kepid")) is not None]
    payload = build_payload(toi_rows, koi_rows, fetch_koi_distances(candidate_stars), k2_rows)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {payload['system_count']} stars with {payload['candidate_count']} planet candidates to {OUTPUT_PATH}")
    print(f"Coverage: {json.dumps(payload['coverage'], sort_keys=True)}")
    print(f"File size: {OUTPUT_PATH.stat().st_size} bytes")


if __name__ == "__main__":
    main()
