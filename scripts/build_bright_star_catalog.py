from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "bright_stars.json"
VIZIER_URL = "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"
SOURCE_TABLE = "I/239/hip_main"
SOURCE_LABEL = "Hipparcos Main Catalogue"
SOURCE_DOC_URL = "https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239"
SOURCE_QUERY = {
    "-source": SOURCE_TABLE,
    "-out": "HIP,HD,RAICRS,DEICRS,Plx,Vmag,B-V,SpType",
    "Vmag": "<6.5",
    "Plx": ">0",
    "-out.max": "unlimited",
}
SOLAR_RADIUS_KM = 695_700.0
SOLAR_EFFECTIVE_TEMPERATURE_K = 5772.0
SOLAR_ABSOLUTE_V_MAG = 4.83

COMMON_STAR_NAMES: dict[int, tuple[str, list[str]]] = {
    7588: ("Achernar", ["Alpha Eridani"]),
    11767: ("Polaris", ["Alpha Ursae Minoris", "North Star"]),
    21421: ("Aldebaran", ["Alpha Tauri"]),
    24436: ("Rigel", ["Beta Orionis"]),
    24608: ("Capella", ["Alpha Aurigae"]),
    27989: ("Betelgeuse", ["Alpha Orionis"]),
    30438: ("Canopus", ["Alpha Carinae"]),
    32349: ("Sirius", ["Alpha Canis Majoris", "Dog Star"]),
    37279: ("Procyon", ["Alpha Canis Minoris"]),
    49669: ("Regulus", ["Alpha Leonis"]),
    60718: ("Acrux", ["Alpha Crucis"]),
    62434: ("Mimosa", ["Beta Crucis"]),
    65474: ("Spica", ["Alpha Virginis"]),
    69673: ("Arcturus", ["Alpha Bootis"]),
    71683: ("Rigil Kentaurus", ["Alpha Centauri", "Alpha Cen"]),
    80763: ("Antares", ["Alpha Scorpii"]),
    91262: ("Vega", ["Alpha Lyrae"]),
    97649: ("Altair", ["Alpha Aquilae"]),
    102098: ("Deneb", ["Alpha Cygni"]),
    113368: ("Fomalhaut", ["Alpha Piscis Austrini"]),
}


def fetch_tsv() -> str:
    url = f"{VIZIER_URL}?{urlencode(SOURCE_QUERY)}"
    request = Request(url, headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=90) as response:
        return response.read().decode("utf-8")


def parse_tsv(text: str) -> list[dict[str, str]]:
    header: list[str] | None = None
    rows: list[dict[str, str]] = []

    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue

        cells = [cell.strip() for cell in line.split("\t")]
        if header is None:
            header = cells
            continue

        joined = "".join(cells)
        if not joined or set(joined) <= {"-"} or cells[0] in {"", "HIP"} or "deg" in cells or "mas" in cells or "mag" in cells:
            continue

        rows.append(dict(zip(header, cells)))

    return rows


def slugify(value: str) -> str:
    normalized = value.strip().lower().replace("+", " plus ")
    normalized = normalized.replace("'", "")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")


def finite_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def finite_int(value: Any) -> int | None:
    number = finite_float(value)
    return int(number) if number is not None else None


def color_temperature_from_bv(bv: float | None) -> float | None:
    if bv is None or bv < -0.4 or bv > 2.4:
        return None
    return 4600.0 * ((1.0 / (0.92 * bv + 1.7)) + (1.0 / (0.92 * bv + 0.62)))


def color_for_star(bv: float | None, spectral_type: str | None) -> str:
    if bv is not None:
        if bv < -0.05:
            return "#a9c7ff"
        if bv < 0.25:
            return "#d4e2ff"
        if bv < 0.55:
            return "#fff1c1"
        if bv < 0.95:
            return "#ffd28c"
        if bv < 1.45:
            return "#f4a278"
        return "#f08f6f"

    spectral = (spectral_type or "").upper()
    if spectral.startswith(("O", "B")):
        return "#a9c7ff"
    if spectral.startswith("A"):
        return "#d4e2ff"
    if spectral.startswith("F"):
        return "#fff1c1"
    if spectral.startswith("G"):
        return "#ffd28c"
    if spectral.startswith("K"):
        return "#f4a278"
    if spectral.startswith("M"):
        return "#f08f6f"
    return "#f0c987"


def estimated_radius_solar(vmag: float | None, distance_pc: float | None, bv: float | None) -> float | None:
    temperature = color_temperature_from_bv(bv)
    if vmag is None or distance_pc is None or distance_pc <= 0 or temperature is None:
        return None

    absolute_magnitude = vmag - 5.0 * math.log10(distance_pc / 10.0)
    luminosity = 10.0 ** ((SOLAR_ABSOLUTE_V_MAG - absolute_magnitude) / 2.5)
    radius = math.sqrt(luminosity) / ((temperature / SOLAR_EFFECTIVE_TEMPERATURE_K) ** 2)
    if not math.isfinite(radius):
        return None
    return max(0.02, min(radius, 2_000.0))


def compact_aliases(hip: int, hd: int | None, common_aliases: list[str]) -> list[str]:
    aliases = [f"HIP {hip}"]
    if hd is not None:
        aliases.append(f"HD {hd}")
    aliases.extend(common_aliases)

    compacted: list[str] = []
    seen: set[str] = set()
    for alias in aliases:
        normalized = alias.strip()
        if normalized and normalized.lower() not in seen:
            compacted.append(normalized)
            seen.add(normalized.lower())
    return compacted


def build_stars(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    stars: list[dict[str, Any]] = []
    for row in rows:
        hip = finite_int(row.get("HIP"))
        ra_deg = finite_float(row.get("RAICRS"))
        dec_deg = finite_float(row.get("DEICRS"))
        parallax_mas = finite_float(row.get("Plx"))
        vmag = finite_float(row.get("Vmag"))
        if hip is None or ra_deg is None or dec_deg is None or parallax_mas is None or parallax_mas <= 0 or vmag is None:
            continue

        hd = finite_int(row.get("HD"))
        bv = finite_float(row.get("B-V"))
        spectral_type = str(row.get("SpType") or "").strip() or None
        distance_pc = 1000.0 / parallax_mas
        absolute_magnitude = vmag - 5.0 * math.log10(distance_pc / 10.0)
        radius_solar = estimated_radius_solar(vmag, distance_pc, bv)
        common = COMMON_STAR_NAMES.get(hip)
        name = common[0] if common else f"HIP {hip}"
        common_aliases = common[1] if common else []

        stars.append(
            {
                "key": f"hip-{hip}",
                "name": name,
                "aliases": compact_aliases(hip, hd, common_aliases),
                "hip": hip,
                "hd": hd,
                "ra_deg": ra_deg,
                "dec_deg": dec_deg,
                "distance_pc": distance_pc,
                "parallax_mas": parallax_mas,
                "apparent_magnitude": vmag,
                "absolute_magnitude": absolute_magnitude,
                "bv_color_index": bv,
                "spectral_type": spectral_type,
                "stellar_teff_k": color_temperature_from_bv(bv),
                "stellar_radius_solar": radius_solar,
                "stellar_radius_source": "estimated from V magnitude, parallax, and B-V color index" if radius_solar is not None else None,
                "radius_km": radius_solar * SOLAR_RADIUS_KM if radius_solar is not None else 0.0,
                "color": color_for_star(bv, spectral_type),
                "why_interesting": "Named bright star from the Hipparcos Main Catalogue." if common else "Bright star from the Hipparcos Main Catalogue.",
            }
        )

    return sorted(stars, key=lambda star: (star["apparent_magnitude"], star["hip"]))


def main() -> None:
    rows = parse_tsv(fetch_tsv())
    stars = build_stars(rows)
    payload = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": SOURCE_LABEL,
            "table": SOURCE_TABLE,
            "vizier_url": VIZIER_URL,
            "documentation_url": SOURCE_DOC_URL,
            "query": SOURCE_QUERY,
        },
        "selection": {
            "apparent_magnitude": "<6.5",
            "parallax_mas": ">0",
        },
        "star_count": len(stars),
        "stars": stars,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {payload['star_count']} bright stars to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
