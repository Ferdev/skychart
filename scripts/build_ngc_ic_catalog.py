from __future__ import annotations

import csv
import json
import math
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "catalogs" / "ngc_ic_deep_sky.json"
OPENNGC_REPO_URL = "https://github.com/mattiaverga/OpenNGC"
OPENNGC_CSV_URL = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv"
OPENNGC_GUIDE_URL = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/NGC_guide.txt"
OPENNGC_LICENSE = "CC-BY-SA-4.0"
HUBBLE_CONSTANT_KM_S_MPC = 70.0
SPEED_OF_LIGHT_KM_S = 299_792.458
OPENNGC_GALAXY_TYPES = {"G", "GPair", "GTrpl", "GGroup"}

TYPE_INFO = {
    "*": ("star", "Star", "#f3f0e8", "A cataloged star entry in the NGC/IC field."),
    "**": ("asterism", "Double star", "#f3f0e8", "A close visual pair of stars."),
    "*Ass": ("star_cluster", "Association of stars", "#9ec8ff", "A loose stellar association."),
    "OCl": ("star_cluster", "Open cluster", "#9ec8ff", "A gravitationally related group of young stars in the Milky Way disk."),
    "GCl": ("star_cluster", "Globular cluster", "#e8d49a", "An old, dense star cluster orbiting the Milky Way halo."),
    "Cl+N": ("nebula", "Star cluster with nebulosity", "#d79bdc", "A star cluster embedded in or overlapping a nebula."),
    "G": ("galaxy", "Galaxy", "#d9b86f", "A distant galaxy beyond the Milky Way."),
    "GPair": ("galaxy", "Galaxy pair", "#d9b86f", "A close apparent or physical pair of galaxies."),
    "GTrpl": ("galaxy", "Galaxy triplet", "#d9b86f", "A compact grouping of three galaxies."),
    "GGroup": ("galaxy", "Group of galaxies", "#d9b86f", "A group of galaxies cataloged as an NGC/IC object."),
    "PN": ("nebula", "Planetary nebula", "#83d8d8", "Glowing gas shed by a dying Sun-like star."),
    "HII": ("nebula", "HII ionized region", "#d79bdc", "An ionized hydrogen region associated with star formation."),
    "DrkN": ("nebula", "Dark nebula", "#6f7280", "A dark cloud of dust obscuring background light."),
    "EmN": ("nebula", "Emission nebula", "#d79bdc", "A glowing cloud of ionized gas."),
    "Neb": ("nebula", "Nebula", "#d79bdc", "An interstellar cloud of gas or dust."),
    "RfN": ("nebula", "Reflection nebula", "#9ec8ff", "A dust cloud reflecting nearby starlight."),
    "SNR": ("nebula", "Supernova remnant", "#f09a73", "Expanding debris from an exploded star."),
    "Nova": ("star", "Nova star", "#f3f0e8", "A stellar outburst recorded in the NGC/IC catalog."),
    "Other": ("deep_sky_object", "Other deep-sky object", "#cdbda2", "An NGC/IC object with a special or uncertain classification."),
}
SKIPPED_TYPES = {"NonEx", "Dup"}


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "CosmicAtlasCatalogBuilder/1.0"})
    with urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def openngc_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "ls-remote", OPENNGC_REPO_URL + ".git", "HEAD"],
            check=True,
            text=True,
            capture_output=True,
            timeout=30,
        )
    except Exception:
        return None
    return result.stdout.split()[0] if result.stdout.split() else None


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    try:
        number = float(cleaned)
    except ValueError:
        return None
    if math.isfinite(number):
        return number
    return None


def parse_ra_deg(value: str) -> float | None:
    parts = value.strip().split(":")
    if len(parts) != 3:
        return None
    hours, minutes, seconds = [parse_float(part) for part in parts]
    if hours is None or minutes is None or seconds is None:
        return None
    return (hours + minutes / 60.0 + seconds / 3600.0) * 15.0


def parse_dec_deg(value: str) -> float | None:
    match = re.fullmatch(r"([+-]?)(\d+):(\d+):(\d+(?:\.\d+)?)", value.strip())
    if not match:
        return None
    sign = -1.0 if match.group(1) == "-" else 1.0
    degrees = float(match.group(2))
    minutes = float(match.group(3))
    seconds = float(match.group(4))
    return sign * (degrees + minutes / 60.0 + seconds / 3600.0)


def designation_from_name(name: str) -> tuple[str, str]:
    match = re.fullmatch(r"(NGC|IC)(\d+[A-Z]?)", name.strip(), flags=re.IGNORECASE)
    if not match:
        return name.lower(), name.upper()
    catalog = match.group(1).lower()
    number = match.group(2).lstrip("0") or "0"
    return f"{catalog}-{number.lower()}", f"{catalog.upper()} {number}"


def prefixed_designation(prefix: str, value: str | None) -> str | None:
    if not value or not value.strip():
        return None
    cleaned = value.strip().lstrip("0") or "0"
    return f"{prefix} {cleaned}"


def split_csv_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def unique(values: list[str | None]) -> list[str]:
    seen = set()
    result: list[str] = []
    for value in values:
        if not value:
            continue
        cleaned = re.sub(r"\s+", " ", str(value)).strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def distance_fields(row: dict[str, str], type_code: str) -> dict[str, object]:
    parallax_mas = parse_float(row.get("Pax"))
    redshift = parse_float(row.get("Redshift"))
    if type_code not in OPENNGC_GALAXY_TYPES and parallax_mas and parallax_mas > 0:
        distance_pc = 1000.0 / parallax_mas
        return {
            "distance_pc": round(distance_pc, 8),
            "distance_ly": round(distance_pc * 3.261563777, 8),
            "distance_quality": "parallax",
        }

    if type_code in OPENNGC_GALAXY_TYPES and redshift and redshift > 0:
        distance_mpc = SPEED_OF_LIGHT_KM_S * redshift / HUBBLE_CONSTANT_KM_S_MPC
        return {
            "distance_pc": round(distance_mpc * 1_000_000.0, 8),
            "distance_ly": round(distance_mpc * 3_261_563.777, 8),
            "distance_quality": "hubble_flow_redshift_approximation",
        }

    return {"distance_quality": "not_available"}


def angular_size(row: dict[str, str]) -> str | None:
    major = parse_float(row.get("MajAx"))
    minor = parse_float(row.get("MinAx"))
    if major is None:
        return None
    if minor is None:
        return f"{major:g}"
    return f"{major:g} x {minor:g}"


def apparent_magnitude(row: dict[str, str]) -> float | None:
    return parse_float(row.get("V-Mag")) or parse_float(row.get("B-Mag"))


def build_object(row: dict[str, str]) -> dict[str, object] | None:
    type_code = row.get("Type", "")
    if type_code in SKIPPED_TYPES:
        return None

    ra_deg = parse_ra_deg(row.get("RA", ""))
    dec_deg = parse_dec_deg(row.get("Dec", ""))
    if ra_deg is None or dec_deg is None:
        return None

    key, primary_designation = designation_from_name(row["Name"])
    object_type, type_label, color, _interesting = TYPE_INFO.get(type_code, TYPE_INFO["Other"])
    common_names = split_csv_list(row.get("Common names"))
    messier = row.get("M") or None
    ngc_cross = prefixed_designation("NGC", row.get("NGC"))
    ic_cross = prefixed_designation("IC", row.get("IC"))

    aliases = unique(
        [
            row["Name"],
            primary_designation,
            primary_designation.replace(" ", ""),
            f"M{messier}" if messier else None,
            f"Messier {messier}" if messier else None,
            ngc_cross,
            ngc_cross.replace(" ", "") if ngc_cross else None,
            ic_cross,
            ic_cross.replace(" ", "") if ic_cross else None,
            *common_names,
        ]
    )

    display_name = primary_designation
    if common_names:
        display_name = f"{display_name} {common_names[0]}"

    facts = {
        "major_axis_arcmin": parse_float(row.get("MajAx")),
        "minor_axis_arcmin": parse_float(row.get("MinAx")),
        "position_angle_deg": parse_float(row.get("PosAng")),
        "b_magnitude": parse_float(row.get("B-Mag")),
        "v_magnitude": parse_float(row.get("V-Mag")),
        "surface_brightness_mag_arcsec2": parse_float(row.get("SurfBr")),
        "hubble_type": row.get("Hubble") or None,
        "parallax_mas": parse_float(row.get("Pax")),
        "pm_ra_mas_yr": parse_float(row.get("Pm-RA")),
        "pm_dec_mas_yr": parse_float(row.get("Pm-Dec")),
        "radial_velocity_km_s": parse_float(row.get("RadVel")),
        "redshift": parse_float(row.get("Redshift")),
        "common_names": common_names,
    }
    facts = {key: value for key, value in facts.items() if value not in (None, "", [], {})}

    obj: dict[str, object] = {
        "key": key,
        "name": display_name,
        "catalog_designation": primary_designation,
        "aliases": aliases,
        "ra_deg": round(ra_deg, 8),
        "dec_deg": round(dec_deg, 8),
        "object_type": object_type,
        "deep_sky_type": type_code,
        "deep_sky_type_label": type_label,
        "constellation": row.get("Const") or None,
        "apparent_magnitude": apparent_magnitude(row),
        "angular_size_arcmin": angular_size(row),
        "color": color,
        "facts": facts,
    }
    if messier:
        obj["messier"] = int(messier) if messier.isdigit() else messier
    if row["Name"].startswith("NGC"):
        obj["ngc"] = primary_designation.removeprefix("NGC ")
    if row["Name"].startswith("IC"):
        obj["ic"] = primary_designation.removeprefix("IC ")
    obj.update(distance_fields(row, type_code))
    return {key: value for key, value in obj.items() if value not in (None, "", [], {})}


def build_catalog(source_csv: str) -> dict[str, object]:
    rows = csv.DictReader(source_csv.splitlines(), delimiter=";")
    objects = [obj for row in rows if (obj := build_object(row)) is not None]
    objects.sort(key=lambda obj: obj["key"])
    commit = openngc_commit()
    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "label": "OpenNGC NGC/IC database",
            "url": OPENNGC_REPO_URL,
            "csv_url": OPENNGC_CSV_URL,
            "guide_url": OPENNGC_GUIDE_URL,
            "license": OPENNGC_LICENSE,
            "commit": commit,
            "used_for": "NGC/IC designations, RA/Dec, object classes, constellation, magnitudes, angular sizes, aliases, common names, and positive-redshift distance estimates for galaxy classes where available",
        },
        "selection": {
            "included": "NGC and IC entries with coordinates and physical/catalog object types",
            "excluded_types": sorted(SKIPPED_TYPES),
            "distance_note": "OpenNGC Pax is used only for non-galaxy classes. Galaxy classes may use a positive redshift with a simple Hubble-flow approximation (H0=70 km/s/Mpc). Galactic classes never use redshift or radial velocity for distance, and radial velocity alone is never converted to distance.",
        },
        "objects": objects,
    }


def main() -> None:
    source_csv = fetch_text(OPENNGC_CSV_URL)
    catalog = build_catalog(source_csv)
    if not 13_000 <= len(catalog["objects"]) <= 13_400:
        raise RuntimeError(f"Expected roughly 13k NGC/IC rows, built {len(catalog['objects'])}")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(catalog, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(catalog['objects'])} objects to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
