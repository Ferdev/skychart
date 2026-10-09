from __future__ import annotations

import html
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "exoplanet_systems.json"
ARCHIVE_URL = "https://exoplanetarchive.ipac.caltech.edu/"
TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
SOURCE_TABLE = "pscomppars"
EPHEMERIS_TABLE = "ps"
SOURCE_LABEL = "NASA Exoplanet Archive Planetary Systems Composite Parameters"
SOURCE_DOC_URL = "https://exoplanetarchive.ipac.caltech.edu/docs/pscp_about.html"
SCHEMA_VERSION = 2

# Display states for one planet. The client must not invent a position:
# "position" needs an orbit size and a usable ephemeris, "orbit_only" needs an
# orbit size, and "none" keeps the planet as a fact on its host star.
DISPLAY_POSITION = "position"
DISPLAY_ORBIT_ONLY = "orbit_only"
DISPLAY_NONE = "none"

JULIAN_DAY_UNIX_EPOCH = 2_440_587.5
SECONDS_PER_DAY = 86_400.0

CALCULATED_REFERENCE = "CALCULATED_VALUE"
MINIMUM_MASS_PROVENANCE = "Msini"
MASS_RADIUS_PROVENANCE = "M-R relationship"

# Composite columns that keep their value, both uncertainties, and limit flag.
MEASUREMENTS = {
    "period_days": "pl_orbper",
    "semi_major_axis_au": "pl_orbsmax",
    "eccentricity": "pl_orbeccen",
    "inclination_deg": "pl_orbincl",
    "argument_of_periastron_deg": "pl_orblper",
}

BOOLEAN_FLAGS = {
    "detected_by_transit": "tran_flag",
    "detected_by_radial_velocity": "rv_flag",
    "detected_by_imaging": "ima_flag",
    "detected_by_microlensing": "micro_flag",
    "transit_timing_variations": "ttv_flag",
    "circumbinary": "cb_flag",
    "controversial": "pl_controv_flag",
}

REFERENCE_QUANTITIES = {
    "period": "pl_orbper_reflink",
    "semi_major_axis": "pl_orbsmax_reflink",
    "radius": "pl_rade_reflink",
    "mass": "pl_bmasse_reflink",
}

QUERY = """
select
  pl_name,
  hostname,
  hd_name,
  hip_name,
  tic_id,
  ra,
  dec,
  sy_dist,
  sy_pnum,
  sy_snum,
  sy_mnum,
  st_rad,
  st_teff,
  st_mass,
  st_spectype,
  pl_rade,
  pl_rade_reflink,
  pl_bmasse,
  pl_bmasse_reflink,
  pl_bmassprov,
  pl_eqt,
  pl_insol,
  pl_orbper,
  pl_orbpererr1,
  pl_orbpererr2,
  pl_orbperlim,
  pl_orbper_reflink,
  pl_orbsmax,
  pl_orbsmaxerr1,
  pl_orbsmaxerr2,
  pl_orbsmaxlim,
  pl_orbsmax_reflink,
  pl_orbeccen,
  pl_orbeccenerr1,
  pl_orbeccenerr2,
  pl_orbeccenlim,
  pl_orbincl,
  pl_orbinclerr1,
  pl_orbinclerr2,
  pl_orbincllim,
  pl_orblper,
  pl_orblpererr1,
  pl_orblpererr2,
  pl_orblperlim,
  pl_orblper_reflink,
  pl_tranmid,
  pl_tranmiderr1,
  pl_tranmiderr2,
  pl_tranmidlim,
  pl_tranmid_systemref,
  pl_tranmid_reflink,
  pl_orbtper,
  pl_orbtpererr1,
  pl_orbtpererr2,
  pl_orbtperlim,
  pl_orbtper_systemref,
  pl_orbtper_reflink,
  tran_flag,
  rv_flag,
  ima_flag,
  micro_flag,
  ttv_flag,
  cb_flag,
  pl_controv_flag,
  discoverymethod,
  disc_year
from pscomppars
where hostname is not null
  and ra is not null
  and dec is not null
  and sy_dist is not null
order by hostname, pl_name
""".strip()

# `pscomppars` takes each value from the paper that the archive prefers for
# that value. A period and a reference time from two papers do not make one
# ephemeris, so the per-paper table supplies a single-paper pair when it can.
EPHEMERIS_QUERY = """
select
  pl_name,
  default_flag,
  pl_refname,
  pl_pubdate,
  pl_orbper,
  pl_orbpererr1,
  pl_orbpererr2,
  pl_orbperlim,
  pl_tranmid,
  pl_tranmiderr1,
  pl_tranmiderr2,
  pl_tranmidlim,
  pl_orbtper,
  pl_orbtpererr1,
  pl_orbtpererr2,
  pl_orbtperlim,
  pl_orblper,
  pl_orblperlim,
  pl_tsystemref
from ps
where pl_orbper is not null
  and (pl_tranmid is not null or pl_orbtper is not null)
order by pl_name
""".strip()

REFERENCE_LINK = re.compile(r"<a\s+refstr=(\S+)\s+href=(\S+?)(?:\s+target=\S+)?\s*>(.*?)</a>", re.IGNORECASE | re.DOTALL)


def fetch_json(query: str) -> list[dict[str, Any]]:
    url = f"{TAP_URL}?{urlencode({'query': query, 'format': 'json'})}"
    request = Request(url, headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError(f"Unexpected TAP response: {payload!r}")
    return payload


def slugify(value: str) -> str:
    normalized = value.strip().lower().replace("+", " plus ")
    normalized = normalized.replace("'", "")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def planet_key(name: str) -> str:
    # Must stay equal to `RowMapper.slug_key/1`, which made the planet keys
    # before the snapshot carried them. Shared links depend on these keys.
    normalized = name.strip().lower().replace("+", " plus ")
    return "exoplanet-" + re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def finite_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def finite_int(value: Any) -> int | None:
    number = finite_float(value)
    return int(number) if number is not None else None


def without_nulls(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if value is not None}


def parse_reference(value: Any) -> dict[str, str] | None:
    """Reads one archive reference anchor into its id, label, and absolute link."""
    match = REFERENCE_LINK.search(str(value or ""))
    if not match:
        return None
    label = re.sub(r"\s+", " ", html.unescape(match.group(3))).strip()
    if not label:
        return None
    return {"id": match.group(1), "label": label, "url": urljoin(ARCHIVE_URL, html.unescape(match.group(2)))}


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


def compact_aliases(row: dict[str, Any]) -> list[str]:
    aliases: list[str] = []
    for key in ("hd_name", "hip_name", "tic_id"):
        value = str(row.get(key) or "").strip()
        if value and value not in aliases:
            aliases.append(value)
    return aliases


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


def interesting_system_note(system: dict[str, Any]) -> str:
    count = system["exoplanet_count"]
    closest = min(
        (planet["semi_major_axis_au"] for planet in system["planets"] if planet.get("semi_major_axis_au") is not None),
        default=None,
    )
    if count >= 7:
        return "A high-multiplicity confirmed exoplanet system."
    if closest is not None and closest < 0.05:
        return "Includes at least one very close-in confirmed planet."
    if system.get("distance_pc") is not None and system["distance_pc"] < 20:
        return "A nearby confirmed exoplanet host system."
    return "A confirmed exoplanet host system from the NASA Exoplanet Archive."


def reference_id(value: Any) -> str | None:
    reference = parse_reference(value)
    return reference["id"] if reference else None


def ephemeris_fields(
    *,
    reference_type: str,
    row: dict[str, Any],
    time_column: str,
    time_system: Any,
    reference: dict[str, str] | None,
    source_table: str,
    mixed: bool,
) -> dict[str, Any]:
    fields = {
        "ephemeris_reference_type": reference_type,
        "ephemeris_time_system": str(time_system or "").strip() or None,
        "ephemeris_source_table": source_table,
        "ephemeris_mixed_references": True if mixed else None,
        **measurement(row, "pl_orbper", "ephemeris_period_days"),
        **measurement(row, time_column, "ephemeris_reference_time_jd"),
    }
    if reference_type == "periastron":
        # A periastron time gives a position only with the argument of
        # periastron from the same solution.
        fields["ephemeris_argument_of_periastron_deg"] = finite_float(row.get("pl_orblper"))
    if reference:
        fields["ephemeris_reference_label"] = reference["label"]
        fields["ephemeris_reference_url"] = reference["url"]
    return without_nulls(fields)


def julian_day(moment: datetime) -> float:
    return moment.timestamp() / SECONDS_PER_DAY + JULIAN_DAY_UNIX_EPOCH


def usable_pair(row: dict[str, Any], time_column: str, snapshot_jd: float) -> bool:
    period = finite_float(row.get("pl_orbper"))
    if period is None or period <= 0 or not is_measured(row, "pl_orbper"):
        return False
    if not is_measured(row, time_column):
        return False
    # A measured epoch is not later than the snapshot. The archive has epochs
    # with a wrong Julian-day offset; one period of margin keeps the predicted
    # passages of long orbits and rejects those records.
    if float(row[time_column]) > snapshot_jd + period:
        return False
    return time_column != "pl_orbtper" or is_measured(row, "pl_orblper")


def single_paper_row(paper_rows: list[dict[str, Any]], time_column: str, snapshot_jd: float) -> dict[str, Any] | None:
    """Selects one per-paper row: the archive default first, then the newest paper."""
    candidates = [row for row in paper_rows if usable_pair(row, time_column, snapshot_jd)]
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda row: (finite_int(row.get("default_flag")) or 0, str(row.get("pl_pubdate") or ""), str(row.get("pl_refname") or "")),
    )


def select_ephemeris(row: dict[str, Any], paper_rows: list[dict[str, Any]], snapshot_jd: float) -> dict[str, Any]:
    """
    Finds the period and reference time that locate the planet on its orbit.

    A conjunction time is preferred because it does not depend on the argument
    of periastron. For each type, one paper must give the period and the time;
    mixed composite values are the last choice and carry a flag.
    """
    period_reference = reference_id(row.get("pl_orbper_reflink"))
    choices = (
        ("conjunction", "pl_tranmid", "pl_tranmid_systemref", "pl_tranmid_reflink"),
        ("periastron", "pl_orbtper", "pl_orbtper_systemref", "pl_orbtper_reflink"),
    )

    def composite(reference_type: str, time_column: str, system_column: str, link_column: str, mixed: bool) -> dict[str, Any]:
        return ephemeris_fields(
            reference_type=reference_type,
            row=row,
            time_column=time_column,
            time_system=row.get(system_column),
            reference=parse_reference(row.get(link_column)),
            source_table=SOURCE_TABLE,
            mixed=mixed,
        )

    def one_paper(time_column: str, link_column: str) -> bool:
        time_reference = reference_id(row.get(link_column))
        if not period_reference or period_reference != time_reference:
            return False
        return time_column != "pl_orbtper" or reference_id(row.get("pl_orblper_reflink")) == time_reference

    for reference_type, time_column, system_column, link_column in choices:
        if usable_pair(row, time_column, snapshot_jd) and one_paper(time_column, link_column):
            return composite(reference_type, time_column, system_column, link_column, False)
        paper_row = single_paper_row(paper_rows, time_column, snapshot_jd)
        if paper_row:
            return ephemeris_fields(
                reference_type=reference_type,
                row=paper_row,
                time_column=time_column,
                time_system=paper_row.get("pl_tsystemref"),
                reference=parse_reference(paper_row.get("pl_refname")),
                source_table=EPHEMERIS_TABLE,
                mixed=False,
            )

    for reference_type, time_column, system_column, link_column in choices:
        if usable_pair(row, time_column, snapshot_jd):
            return composite(reference_type, time_column, system_column, link_column, True)
    return {}


def planet_references(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Groups the composite reference links by paper to keep the record small."""
    grouped: dict[str, dict[str, Any]] = {}
    for quantity, column in REFERENCE_QUANTITIES.items():
        reference = parse_reference(row.get(column))
        if not reference or reference["id"] == CALCULATED_REFERENCE:
            continue
        entry = grouped.setdefault(reference["id"], {"label": reference["label"], "url": reference["url"], "quantities": []})
        entry["quantities"].append(quantity)
    return sorted(grouped.values(), key=lambda entry: entry["label"])


def display_state(planet: dict[str, Any]) -> str:
    semi_major_axis = planet.get("semi_major_axis_au")
    if semi_major_axis is None or semi_major_axis <= 0:
        return DISPLAY_NONE
    if planet.get("semi_major_axis_au_limit") or "ephemeris_reference_type" not in planet:
        return DISPLAY_ORBIT_ONLY
    return DISPLAY_POSITION


def planet_has(row: dict[str, Any], column: str) -> bool:
    return finite_float(row.get(column)) is not None


def build_planet(row: dict[str, Any], paper_rows: list[dict[str, Any]], snapshot_jd: float) -> dict[str, Any]:
    name = str(row.get("pl_name") or "").strip()
    mass_provenance = str(row.get("pl_bmassprov") or "").strip() or None
    planet: dict[str, Any] = {
        "key": planet_key(name),
        "name": name,
        "radius_earth": finite_float(row.get("pl_rade")),
        "mass_earth": finite_float(row.get("pl_bmasse")),
        "discovery_method": str(row.get("discoverymethod") or "").strip() or None,
        "discovery_year": finite_int(row.get("disc_year")),
        "equilibrium_temperature_k": finite_float(row.get("pl_eqt")),
        "insolation_earth": finite_float(row.get("pl_insol")),
        "mass_provenance": mass_provenance if planet_has(row, "pl_bmasse") else None,
    }
    for key, column in MEASUREMENTS.items():
        planet.update(measurement(row, column, key))
    for key, column in BOOLEAN_FLAGS.items():
        if finite_int(row.get(column)):
            planet[key] = True
    if planet_has(row, "pl_bmasse") and mass_provenance == MINIMUM_MASS_PROVENANCE:
        planet["minimum_mass"] = True
    if planet_has(row, "pl_bmasse") and mass_provenance == MASS_RADIUS_PROVENANCE:
        planet["mass_calculated"] = True
    if planet_has(row, "pl_rade") and reference_id(row.get("pl_rade_reflink")) == CALCULATED_REFERENCE:
        planet["radius_calculated"] = True
    if planet_has(row, "pl_orbsmax") and reference_id(row.get("pl_orbsmax_reflink")) == CALCULATED_REFERENCE:
        planet["semi_major_axis_calculated"] = True
    references = planet_references(row)
    if references:
        planet["references"] = references
    planet.update(select_ephemeris(row, paper_rows, snapshot_jd))
    planet["orbit_display_state"] = display_state(planet)
    if planet["orbit_display_state"] != DISPLAY_POSITION:
        for key in [key for key in planet if key.startswith("ephemeris_")]:
            del planet[key]
    return without_nulls(planet)


def build_systems(
    rows: list[dict[str, Any]],
    ephemeris_rows: list[dict[str, Any]] | None = None,
    snapshot_time: datetime | None = None,
) -> list[dict[str, Any]]:
    snapshot_jd = julian_day(snapshot_time or datetime.now(timezone.utc))
    by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        host = str(row.get("hostname") or "").strip()
        if host:
            by_host[host].append(row)

    papers_by_planet: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for paper_row in ephemeris_rows or []:
        papers_by_planet[str(paper_row.get("pl_name") or "").strip()].append(paper_row)

    systems: list[dict[str, Any]] = []
    for hostname, host_rows in sorted(by_host.items(), key=lambda item: item[0].lower()):
        first = host_rows[0]
        aliases = compact_aliases(first)
        planets = []
        planet_aliases = []
        seen_planets: set[str] = set()

        for row in host_rows:
            planet_name = str(row.get("pl_name") or "").strip()
            if not planet_name or planet_name in seen_planets:
                continue
            seen_planets.add(planet_name)
            planet_aliases.append(planet_name)
            planets.append(build_planet(row, papers_by_planet.get(planet_name, []), snapshot_jd))

        systems.append(
            without_nulls(
                {
                    "key": f"exosys-{slugify(hostname)}",
                    "name": hostname,
                    "aliases": [*aliases, *planet_aliases],
                    "ra_deg": finite_float(first.get("ra")),
                    "dec_deg": finite_float(first.get("dec")),
                    "distance_pc": finite_float(first.get("sy_dist")),
                    "exoplanet_count": len(planets),
                    "system_star_count": finite_int(first.get("sy_snum")),
                    "system_planet_count": finite_int(first.get("sy_pnum")),
                    "system_moon_count": finite_int(first.get("sy_mnum")),
                    "stellar_radius_solar": finite_float(first.get("st_rad")),
                    "stellar_teff_k": finite_float(first.get("st_teff")),
                    "stellar_mass_solar": finite_float(first.get("st_mass")),
                    "spectral_type": str(first.get("st_spectype") or "").strip() or None,
                    "color": color_for_star(finite_float(first.get("st_teff"))),
                    "planets": sorted(planets, key=lambda planet: (planet.get("semi_major_axis_au") is None, planet.get("semi_major_axis_au") or 0, planet["name"])),
                }
            )
        )

    for system in systems:
        system["why_interesting"] = interesting_system_note(system)

    return systems


def catalog_keys(systems: list[dict[str, Any]]) -> set[str]:
    keys: set[str] = set()
    for system in systems:
        keys.add(str(system["key"]))
        for planet in system.get("planets", []):
            keys.add(str(planet.get("key") or planet_key(str(planet["name"]))))
    return keys


def compare_keys(previous: list[dict[str, Any]], current: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Reports the keys that a new snapshot removes or adds; a removed key stops a shared link."""
    before = catalog_keys(previous)
    after = catalog_keys(current)
    return {"removed": sorted(before - after), "added": sorted(after - before)}


def coverage(systems: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    planets = [planet for system in systems for planet in system["planets"]]
    return {
        "orbit_display_state": dict(sorted(Counter(planet["orbit_display_state"] for planet in planets).items())),
        "ephemeris_reference_type": dict(sorted(Counter(
            planet["ephemeris_reference_type"] for planet in planets if "ephemeris_reference_type" in planet
        ).items())),
        "ephemeris_source_table": dict(sorted(Counter(
            planet["ephemeris_source_table"] for planet in planets if "ephemeris_source_table" in planet
        ).items())),
        "ephemeris_mixed_references": {"true": sum(1 for planet in planets if planet.get("ephemeris_mixed_references"))},
    }


def build_payload(rows: list[dict[str, Any]], ephemeris_rows: list[dict[str, Any]]) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc)
    systems = build_systems(rows, ephemeris_rows, generated_at)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at_utc": generated_at.isoformat().replace("+00:00", "Z"),
        # The importer copies `source` to each catalog row and each API
        # response. The long query texts stay out of it for that reason.
        "source": {
            "name": SOURCE_LABEL,
            "table": SOURCE_TABLE,
            "ephemeris_table": EPHEMERIS_TABLE,
            "tap_url": TAP_URL,
            "documentation_url": SOURCE_DOC_URL,
        },
        "queries": {SOURCE_TABLE: QUERY, EPHEMERIS_TABLE: EPHEMERIS_QUERY},
        "planet_count": sum(system["exoplanet_count"] for system in systems),
        "system_count": len(systems),
        "coverage": coverage(systems),
        "systems": systems,
    }


def main() -> None:
    payload = build_payload(fetch_json(QUERY), fetch_json(EPHEMERIS_QUERY))
    if OUTPUT_PATH.exists():
        previous = json.loads(OUTPUT_PATH.read_text(encoding="utf-8")).get("systems", [])
        changes = compare_keys(previous, payload["systems"])
        print(f"Key comparison: {len(changes['removed'])} removed, {len(changes['added'])} added")
        for key in changes["removed"]:
            print(f"  removed {key}")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {payload['system_count']} systems with {payload['planet_count']} planets to {OUTPUT_PATH}")
    print(f"Coverage: {json.dumps(payload['coverage'], sort_keys=True)}")
    print(f"File size: {OUTPUT_PATH.stat().st_size} bytes")


if __name__ == "__main__":
    main()
