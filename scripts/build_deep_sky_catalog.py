from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "deep_sky_catalog.json"
MESSIER_SOURCE_URL = "https://astropixels.com/messier/messiercat.html"
HEASARC_REFERENCE_URL = "https://heasarc.gsfc.nasa.gov/W3Browse/general-catalog/messier.html"

TYPE_INFO = {
    "Oc": {
        "object_type": "star_cluster",
        "label": "Open cluster",
        "color": "#9ec8ff",
        "observing": "binoculars",
        "interesting": "A gravitationally related group of young stars in the Milky Way disk.",
    },
    "Gc": {
        "object_type": "star_cluster",
        "label": "Globular cluster",
        "color": "#e8d49a",
        "observing": "small telescope",
        "interesting": "An old, dense star cluster orbiting the Milky Way halo.",
    },
    "Pl": {
        "object_type": "nebula",
        "label": "Planetary nebula",
        "color": "#83d8d8",
        "observing": "small telescope",
        "interesting": "Glowing gas shed by a dying Sun-like star.",
    },
    "Di": {
        "object_type": "nebula",
        "label": "Diffuse nebula",
        "color": "#d79bdc",
        "observing": "small telescope",
        "interesting": "A bright cloud of interstellar gas and dust.",
    },
    "Sn": {
        "object_type": "nebula",
        "label": "Supernova remnant",
        "color": "#f09a73",
        "observing": "small telescope",
        "interesting": "Expanding debris from an exploded star.",
    },
    "Sp": {
        "object_type": "galaxy",
        "label": "Spiral galaxy",
        "color": "#d9b86f",
        "observing": "small telescope",
        "interesting": "A distant island of stars with spiral structure.",
    },
    "Ba": {
        "object_type": "galaxy",
        "label": "Barred spiral galaxy",
        "color": "#d6a657",
        "observing": "small telescope",
        "interesting": "A spiral galaxy with a central stellar bar.",
    },
    "El": {
        "object_type": "galaxy",
        "label": "Elliptical galaxy",
        "color": "#cdbda2",
        "observing": "small telescope",
        "interesting": "A smooth, old stellar system with little visible spiral structure.",
    },
    "Ir": {
        "object_type": "galaxy",
        "label": "Irregular galaxy",
        "color": "#d9a382",
        "observing": "small telescope",
        "interesting": "A galaxy without a clean spiral or elliptical shape.",
    },
    "Ln": {
        "object_type": "galaxy",
        "label": "Lenticular galaxy",
        "color": "#c7b28a",
        "observing": "small telescope",
        "interesting": "A disk galaxy with little obvious spiral structure.",
    },
    "As": {
        "object_type": "asterism",
        "label": "Asterism",
        "color": "#f3f0e8",
        "observing": "binoculars",
        "interesting": "A recognizable apparent pattern of stars.",
    },
    "Ds": {
        "object_type": "asterism",
        "label": "Double star",
        "color": "#f3f0e8",
        "observing": "binoculars",
        "interesting": "A close visual pair of stars.",
    },
    "MW": {
        "object_type": "milky_way_patch",
        "label": "Milky Way patch",
        "color": "#b8d7ff",
        "observing": "naked eye",
        "interesting": "A bright star cloud in our own galaxy.",
    },
}


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def cell_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", "", value)
    normalized = html.unescape(without_tags)
    return re.sub(r"\s+", " ", normalized).strip()


def parse_ra_deg(value: str) -> float:
    match = re.fullmatch(r"(\d+)h(?:\s+([\d.]+)m)?", value.strip())
    if not match:
        raise ValueError(f"Could not parse RA: {value}")
    hours = float(match.group(1))
    minutes = float(match.group(2) or "0")
    return (hours + minutes / 60.0) * 15.0


def parse_dec_deg(value: str) -> float:
    match = re.fullmatch(r"([+-])(\d+)°\s*(\d+)′", value.strip())
    if not match:
        raise ValueError(f"Could not parse Dec: {value}")
    sign = -1.0 if match.group(1) == "-" else 1.0
    degrees = float(match.group(2))
    minutes = float(match.group(3))
    return sign * (degrees + minutes / 60.0)


def parse_distance_ly(value: str) -> float:
    cleaned = value.replace(",", "").strip().lower()
    if cleaned.endswith("million"):
        number = float(cleaned.removesuffix("million").strip())
        return number * 1_000_000.0
    return float(cleaned)


def parse_float(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def parse_ngc_ic(value: str) -> tuple[str | None, str | None]:
    cleaned = value.strip()
    if not cleaned or cleaned == "-":
        return None, None
    if cleaned.upper().startswith("IC"):
        return None, cleaned.upper().replace(" ", "")
    return cleaned, None


def season_label(value: str) -> str:
    return value[:1].upper() + value[1:] if value else value


def equipment_for(magnitude: float | None, default: str) -> str:
    if magnitude is None:
        return default
    if magnitude <= 4.5:
        return "naked eye / binoculars"
    if magnitude <= 7.5:
        return "binoculars"
    if magnitude <= 10.0:
        return "small telescope"
    return "larger telescope"


def parse_messier_catalog(source_html: str) -> list[dict[str, object]]:
    rows = re.findall(r'<tr class="(?:odd|even)">(.*?)</tr>', source_html, flags=re.DOTALL)
    objects: list[dict[str, object]] = []

    for row in rows:
        cells = [cell_text(cell) for cell in re.findall(r"<td>(.*?)</td>", row, flags=re.DOTALL)]
        if len(cells) != 11 or not re.fullmatch(r"M\d+", cells[0]):
            continue

        messier = int(cells[0][1:])
        ngc, ic = parse_ngc_ic(cells[1])
        type_code = cells[2]
        type_info = TYPE_INFO[type_code]
        magnitude = parse_float(cells[3])
        distance_ly = parse_distance_ly(cells[5])
        common_name = cells[10].strip() or None
        aliases = [cells[0], f"Messier {messier}"]
        if ngc:
            aliases.extend([f"NGC {ngc}", f"NGC{ngc}"])
        if ic:
            aliases.extend([ic.replace("IC", "IC "), ic])
        if common_name:
            aliases.append(common_name)

        display_name = f"M{messier}"
        if common_name:
            display_name = f"{display_name} {common_name}"

        objects.append(
            {
                "key": f"m{messier}",
                "name": display_name,
                "messier": messier,
                "ngc": ngc,
                "ic": ic,
                "aliases": aliases,
                "ra_deg": round(parse_ra_deg(cells[6]), 8),
                "dec_deg": round(parse_dec_deg(cells[7]), 8),
                "distance_ly": distance_ly,
                "distance_quality": "catalog_estimate",
                "object_type": type_info["object_type"],
                "deep_sky_type": type_code,
                "deep_sky_type_label": type_info["label"],
                "apparent_magnitude": magnitude,
                "angular_size_arcmin": cells[4],
                "constellation": cells[8],
                "viewing_season": season_label(cells[9]),
                "common_name": common_name,
                "observing_equipment": equipment_for(magnitude, type_info["observing"]),
                "why_interesting": type_info["interesting"],
                "color": type_info["color"],
                "source": "AstroPixels Messier catalog table; NASA HEASARC Messier notes for catalog context",
            }
        )

    if len(objects) != 110:
        raise RuntimeError(f"Expected 110 Messier rows, parsed {len(objects)}")

    return objects


def main() -> None:
    source_html = fetch_text(MESSIER_SOURCE_URL)
    catalog = {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": [
            {
                "label": "AstroPixels Messier Catalog",
                "url": MESSIER_SOURCE_URL,
                "used_for": "Messier RA/Dec, distance, magnitude, angular size, constellation, season, common names",
            },
            {
                "label": "NASA HEASARC Messier table notes",
                "url": HEASARC_REFERENCE_URL,
                "used_for": "Catalog context, field definitions, and object class descriptions",
            },
        ],
        "objects": parse_messier_catalog(source_html),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(catalog['objects'])} objects to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
