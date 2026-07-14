from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "exoplanet_systems.json"
TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
SOURCE_TABLE = "pscomppars"
SOURCE_LABEL = "NASA Exoplanet Archive Planetary Systems Composite Parameters"
SOURCE_DOC_URL = "https://exoplanetarchive.ipac.caltech.edu/docs/pscp_about.html"

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
  pl_bmasse,
  pl_orbper,
  pl_orbsmax,
  discoverymethod,
  disc_year
from pscomppars
where hostname is not null
  and ra is not null
  and dec is not null
  and sy_dist is not null
order by hostname, pl_name
""".strip()


def fetch_json(query: str) -> list[dict[str, Any]]:
    url = f"{TAP_URL}?{urlencode({'query': query, 'format': 'json'})}"
    request = Request(url, headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=90) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError(f"Unexpected TAP response: {payload!r}")
    return payload


def slugify(value: str) -> str:
    normalized = value.strip().lower().replace("+", " plus ")
    normalized = normalized.replace("'", "")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


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


def build_systems(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        host = str(row.get("hostname") or "").strip()
        if host:
            by_host[host].append(row)

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
            planets.append(
                {
                    "name": planet_name,
                    "radius_earth": finite_float(row.get("pl_rade")),
                    "mass_earth": finite_float(row.get("pl_bmasse")),
                    "period_days": finite_float(row.get("pl_orbper")),
                    "semi_major_axis_au": finite_float(row.get("pl_orbsmax")),
                    "discovery_method": str(row.get("discoverymethod") or "").strip() or None,
                    "discovery_year": finite_int(row.get("disc_year")),
                }
            )

        systems.append(
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

    for system in systems:
        system["why_interesting"] = interesting_system_note(system)

    return systems


def main() -> None:
    rows = fetch_json(QUERY)
    systems = build_systems(rows)
    payload = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": SOURCE_LABEL,
            "table": SOURCE_TABLE,
            "tap_url": TAP_URL,
            "documentation_url": SOURCE_DOC_URL,
            "query": QUERY,
        },
        "planet_count": sum(system["exoplanet_count"] for system in systems),
        "system_count": len(systems),
        "systems": systems,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {payload['system_count']} systems with {payload['planet_count']} planets to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
