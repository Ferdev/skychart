from __future__ import annotations

import json
import hashlib
import logging
import math
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import urlopen, urlretrieve

from skyfield.api import Loader, Star, load_file, wgs84
from skyfield.framelib import ecliptic_frame


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "skyfield"
CACHE_DIR = ROOT / "data" / "cache"
DEEP_SKY_CATALOG_PATH = ROOT / "data" / "catalogs" / "deep_sky_catalog.json"
EXOPLANET_CATALOG_PATH = ROOT / "data" / "catalogs" / "exoplanet_systems.json"
BRIGHT_STAR_CATALOG_PATH = ROOT / "data" / "catalogs" / "bright_stars.json"
HOST = "127.0.0.1"
PORT = int(os.environ.get("ATLAS_API_PORT", "8765"))
AU_KM = 149_597_870.700
PARSEC_AU = 206_264.80624709636
LIGHT_YEAR_KM = 9_460_730_472_580.8
SUN_MU_KM3_S2 = 132_712_440_018.0
SECONDS_PER_DAY = 86_400.0
CACHE_SCHEMA_VERSION = 5
LIVE_TIMESTAMP_BUCKET_SECONDS = 300
EPHEMERIS_SOURCE = (
    "NASA/JPL DE440s ephemeris via Skyfield; NAIF MAR099s satellite SPK; NASA/JPL Horizons vectors; "
    "NASA Exoplanet Archive host-star and confirmed-planet catalog; Hipparcos bright-star catalog via CDS/VizieR; "
    "generated Messier deep-sky catalog snapshot; Phoenix catalog index for Gaia DR3 bulk slices, SIMBAD, and JPL SBDB generated slices"
)
SATELLITE_KERNEL_URLS = {
    "mar099s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/mar099s.bsp",
}

CATALOG_GROUPS = {
    "core": {
        "label": "Core Solar System",
        "description": "Sun, planets, Earth's Moon, and Pluto barycenter from DE440s.",
    },
    "mars_moons": {
        "label": "Mars moons",
        "description": "Phobos and Deimos from the NAIF MAR099s satellite SPK.",
    },
    "jupiter_major_moons": {
        "label": "Jupiter major moons",
        "description": "Galilean moons from NASA/JPL Horizons parent-relative vectors.",
    },
    "saturn_major_moons": {
        "label": "Saturn major moons",
        "description": "Major Saturnian moons from NASA/JPL Horizons parent-relative vectors.",
    },
    "nearby_exoplanet_systems": {
        "label": "Nearby exoplanet systems",
        "description": "Nearby confirmed exoplanet host stars from NASA Exoplanet Archive coordinates and distances.",
    },
    "exoplanet_systems": {
        "label": "Confirmed exoplanet systems",
        "description": "Generated NASA Exoplanet Archive snapshot of confirmed exoplanet host systems with planet lists.",
    },
    "bright_stars": {
        "label": "Hipparcos bright stars",
        "description": "Generated Hipparcos Main Catalogue slice from CDS/VizieR with V magnitude < 6.5 and positive parallax.",
    },
    "gaia_local_stars": {
        "label": "Gaia DR3 local stars",
        "description": "Generated ESA Gaia DR3 local-neighborhood slice loaded through Phoenix viewport/search catalog queries.",
    },
    "gaia_500pc_stars": {
        "label": "Gaia DR3 500 pc stars",
        "description": "Bulk ESA Gaia DR3 500 pc, G <= 14, quality-filtered star slice streamed directly into Phoenix/Postgres.",
    },
    "messier_deep_sky": {
        "label": "Messier deep-sky catalog",
        "description": "Distance-known Messier objects with NGC/IC aliases, RA/Dec, magnitudes, angular sizes, and viewing metadata.",
    },
    "simbad_extragalactic": {
        "label": "SIMBAD extragalactic catalog",
        "description": "Generated SIMBAD TAP slice of galaxies, quasars, and active galactic nuclei with redshift-derived distances.",
    },
    "jpl_small_bodies": {
        "label": "JPL small bodies",
        "description": "Generated NASA/JPL Small-Body Database slice of large asteroids, near-Earth asteroids, and comets.",
    },
}
DEFAULT_CATALOG_GROUPS = tuple(CATALOG_GROUPS.keys())
STARTUP_CATALOG_GROUPS = (
    "core",
    "mars_moons",
    "jupiter_major_moons",
    "saturn_major_moons",
    "nearby_exoplanet_systems",
    "messier_deep_sky",
)
STATIC_CATALOG_SOURCE_TYPES = {"stellar_catalog", "exoplanet_archive_system", "bright_star_catalog", "deep_sky_catalog"}
HORIZONS_PARENT_CENTERS = {
    "jupiter": "@5",
    "saturn": "@6",
}
CATALOG_SEARCH_DEFAULT_LIMIT = 80
CATALOG_SEARCH_MAX_LIMIT = 300


def catalog_object(
    *,
    key: str,
    name: str,
    ephemeris: str | int,
    radius_km: float,
    mu_km3_s2: float,
    color: str,
    object_type: str,
    catalog_group: str,
    parent_key: str | None = None,
    kernel: str | None = None,
    horizons_id: str | None = None,
    source_type: str | None = None,
    ra_deg: float | None = None,
    dec_deg: float | None = None,
    distance_pc: float | None = None,
    parallax_mas: float | None = None,
    hip: int | None = None,
    hd: int | None = None,
    exoplanet_count: int | None = None,
    stellar_radius_solar: float | None = None,
    stellar_teff_k: float | None = None,
    stellar_mass_solar: float | None = None,
    spectral_type: str | None = None,
    bv_color_index: float | None = None,
    absolute_magnitude: float | None = None,
    stellar_radius_source: str | None = None,
    system_star_count: int | None = None,
    system_planet_count: int | None = None,
    system_moon_count: int | None = None,
    planets: list[dict[str, Any]] | None = None,
    aliases: list[str] | None = None,
    distance_ly: float | None = None,
    distance_quality: str | None = None,
    messier: int | None = None,
    ngc: str | None = None,
    ic: str | None = None,
    deep_sky_type: str | None = None,
    deep_sky_type_label: str | None = None,
    apparent_magnitude: float | None = None,
    angular_size_arcmin: str | None = None,
    constellation: str | None = None,
    viewing_season: str | None = None,
    common_name: str | None = None,
    observing_equipment: str | None = None,
    why_interesting: str | None = None,
    angular_major_arcmin: float | None = None,
    angular_minor_arcmin: float | None = None,
    physical_diameter_ly: float | None = None,
    physical_minor_diameter_ly: float | None = None,
    physical_size_note: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "name": name,
        "ephemeris": ephemeris,
        "kernel": kernel,
        "radius_km": radius_km,
        "mu_km3_s2": mu_km3_s2,
        "color": color,
        "object_type": object_type,
        "catalog_group": catalog_group,
        "parent_key": parent_key,
        "horizons_id": horizons_id,
        "source_type": source_type or ("horizons" if horizons_id else "spk"),
        "ra_deg": ra_deg,
        "dec_deg": dec_deg,
        "distance_pc": distance_pc,
        "parallax_mas": parallax_mas,
        "hip": hip,
        "hd": hd,
        "exoplanet_count": exoplanet_count,
        "stellar_radius_solar": stellar_radius_solar,
        "stellar_teff_k": stellar_teff_k,
        "stellar_mass_solar": stellar_mass_solar,
        "spectral_type": spectral_type,
        "bv_color_index": bv_color_index,
        "absolute_magnitude": absolute_magnitude,
        "stellar_radius_source": stellar_radius_source,
        "system_star_count": system_star_count,
        "system_planet_count": system_planet_count,
        "system_moon_count": system_moon_count,
        "planets": planets or [],
        "aliases": aliases or [],
        "distance_ly": distance_ly,
        "distance_quality": distance_quality,
        "messier": messier,
        "ngc": ngc,
        "ic": ic,
        "deep_sky_type": deep_sky_type,
        "deep_sky_type_label": deep_sky_type_label,
        "apparent_magnitude": apparent_magnitude,
        "angular_size_arcmin": angular_size_arcmin,
        "constellation": constellation,
        "viewing_season": viewing_season,
        "common_name": common_name,
        "observing_equipment": observing_equipment,
        "why_interesting": why_interesting,
        "angular_major_arcmin": angular_major_arcmin,
        "angular_minor_arcmin": angular_minor_arcmin,
        "physical_diameter_ly": physical_diameter_ly,
        "physical_minor_diameter_ly": physical_minor_diameter_ly,
        "physical_size_note": physical_size_note,
    }


CATALOG_OBJECTS = [
    catalog_object(key="sun", name="Sun", ephemeris="sun", radius_km=695_700, mu_km3_s2=SUN_MU_KM3_S2, color="#ffd166", object_type="star", catalog_group="core"),
    catalog_object(key="mercury", name="Mercury", ephemeris="mercury", radius_km=2_439.7, mu_km3_s2=22_031.78, color="#b8a48a", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="venus", name="Venus", ephemeris="venus", radius_km=6_051.8, mu_km3_s2=324_858.592, color="#d8b26f", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="earth", name="Earth", ephemeris="earth", radius_km=6_371.0, mu_km3_s2=398_600.4418, color="#62a8ff", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="moon", name="Moon", ephemeris="moon", radius_km=1_737.4, mu_km3_s2=4_902.800066, color="#c8c8c8", object_type="moon", parent_key="earth", catalog_group="core"),
    catalog_object(key="mars", name="Mars", ephemeris="mars barycenter", radius_km=3_389.5, mu_km3_s2=42_828.375214, color="#df6b43", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="jupiter", name="Jupiter", ephemeris="jupiter barycenter", radius_km=69_911, mu_km3_s2=126_686_534.0, color="#d9b382", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="saturn", name="Saturn", ephemeris="saturn barycenter", radius_km=58_232, mu_km3_s2=37_931_187.0, color="#d8c28a", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="uranus", name="Uranus", ephemeris="uranus barycenter", radius_km=25_362, mu_km3_s2=5_793_939.0, color="#83d8d8", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="neptune", name="Neptune", ephemeris="neptune barycenter", radius_km=24_622, mu_km3_s2=6_836_529.0, color="#6f8cff", object_type="planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="pluto", name="Pluto", ephemeris="pluto barycenter", radius_km=1_188.3, mu_km3_s2=869.61, color="#c9a27c", object_type="dwarf_planet", parent_key="sun", catalog_group="core"),
    catalog_object(key="phobos", name="Phobos", ephemeris=401, kernel="mar099s.bsp", radius_km=11.27, mu_km3_s2=0.0007087, color="#9b8066", object_type="moon", parent_key="mars", catalog_group="mars_moons"),
    catalog_object(key="deimos", name="Deimos", ephemeris=402, kernel="mar099s.bsp", radius_km=6.2, mu_km3_s2=0.0000985, color="#b19a82", object_type="moon", parent_key="mars", catalog_group="mars_moons"),
    catalog_object(key="io", name="Io", ephemeris=501, horizons_id="501", radius_km=1_821.6, mu_km3_s2=5_959.916, color="#e5c45f", object_type="moon", parent_key="jupiter", catalog_group="jupiter_major_moons"),
    catalog_object(key="europa", name="Europa", ephemeris=502, horizons_id="502", radius_km=1_560.8, mu_km3_s2=3_202.739, color="#d8c7a8", object_type="moon", parent_key="jupiter", catalog_group="jupiter_major_moons"),
    catalog_object(key="ganymede", name="Ganymede", ephemeris=503, horizons_id="503", radius_km=2_634.1, mu_km3_s2=9_887.834, color="#a89980", object_type="moon", parent_key="jupiter", catalog_group="jupiter_major_moons"),
    catalog_object(key="callisto", name="Callisto", ephemeris=504, horizons_id="504", radius_km=2_410.3, mu_km3_s2=7_179.289, color="#7b6a58", object_type="moon", parent_key="jupiter", catalog_group="jupiter_major_moons"),
    catalog_object(key="mimas", name="Mimas", ephemeris=601, horizons_id="601", radius_km=198.2, mu_km3_s2=2.503, color="#b9b7ad", object_type="moon", parent_key="saturn", catalog_group="saturn_major_moons"),
    catalog_object(key="enceladus", name="Enceladus", ephemeris=602, horizons_id="602", radius_km=252.1, mu_km3_s2=7.209, color="#dfe9ef", object_type="moon", parent_key="saturn", catalog_group="saturn_major_moons"),
    catalog_object(key="tethys", name="Tethys", ephemeris=603, horizons_id="603", radius_km=531.1, mu_km3_s2=41.21, color="#c9c7bd", object_type="moon", parent_key="saturn", catalog_group="saturn_major_moons"),
    catalog_object(key="dione", name="Dione", ephemeris=604, horizons_id="604", radius_km=561.4, mu_km3_s2=73.11, color="#c6c7c2", object_type="moon", parent_key="saturn", catalog_group="saturn_major_moons"),
    catalog_object(key="rhea", name="Rhea", ephemeris=605, horizons_id="605", radius_km=763.8, mu_km3_s2=153.94, color="#b9b5aa", object_type="moon", parent_key="saturn", catalog_group="saturn_major_moons"),
    catalog_object(key="titan", name="Titan", ephemeris=606, horizons_id="606", radius_km=2_574.73, mu_km3_s2=8_978.14, color="#d6a657", object_type="moon", parent_key="saturn", catalog_group="saturn_major_moons"),
    catalog_object(key="iapetus", name="Iapetus", ephemeris=608, horizons_id="608", radius_km=734.5, mu_km3_s2=120.5, color="#8d8070", object_type="moon", parent_key="saturn", catalog_group="saturn_major_moons"),
    catalog_object(key="proxima-cen", name="Proxima Cen", ephemeris="Proxima Cen", source_type="stellar_catalog", radius_km=98_124, mu_km3_s2=0.0, color="#f08f6f", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=217.3934657, dec_deg=-62.6761821, distance_pc=1.30119, exoplanet_count=2, stellar_radius_solar=0.141, stellar_teff_k=2900),
    catalog_object(key="barnards-star", name="Barnard's star", ephemeris="Barnard's star", source_type="stellar_catalog", radius_km=128_705, mu_km3_s2=0.0, color="#f19a75", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=269.4486144, dec_deg=4.7379808, distance_pc=1.82655, exoplanet_count=4, stellar_radius_solar=0.185, stellar_teff_k=3195),
    catalog_object(key="eps-eri", name="eps Eri", ephemeris="eps Eri", source_type="stellar_catalog", radius_km=512_000, mu_km3_s2=0.0, color="#ffd08a", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=53.2284306, dec_deg=-9.4581715, distance_pc=3.2026, exoplanet_count=1),
    catalog_object(key="gj-887", name="GJ 887", ephemeris="GJ 887", source_type="stellar_catalog", radius_km=325_588, mu_km3_s2=0.0, color="#f3a078", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=346.5027573, dec_deg=-35.8473489, distance_pc=3.28679, exoplanet_count=4, stellar_radius_solar=0.468, stellar_teff_k=3688),
    catalog_object(key="ross-128", name="Ross 128", ephemeris="Ross 128", source_type="stellar_catalog", radius_km=136_856, mu_km3_s2=0.0, color="#f19573", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=176.9376036, dec_deg=0.7992898, distance_pc=3.37454, exoplanet_count=1, stellar_radius_solar=0.1967, stellar_teff_k=3192),
    catalog_object(key="gl-725-a", name="Gl 725 A", ephemeris="Gl 725 A", source_type="stellar_catalog", radius_km=244_291, mu_km3_s2=0.0, color="#f4a67c", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=280.6834312, dec_deg=59.638109, distance_pc=3.5214, exoplanet_count=1, stellar_radius_solar=0.351, stellar_teff_k=3433),
    catalog_object(key="gj-15-a", name="GJ 15 A", ephemeris="GJ 15 A", source_type="stellar_catalog", radius_km=264_366, mu_km3_s2=0.0, color="#f4a87e", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=4.6126677, dec_deg=44.0247296, distance_pc=3.56228, exoplanet_count=2, stellar_radius_solar=0.38, stellar_teff_k=3607),
    catalog_object(key="tau-cet", name="tau Cet", ephemeris="tau Cet", source_type="stellar_catalog", radius_km=552_000, mu_km3_s2=0.0, color="#ffd99d", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=26.0093029, dec_deg=-15.9337987, distance_pc=3.60304, exoplanet_count=3),
    catalog_object(key="eps-ind-a", name="eps Ind A", ephemeris="eps Ind A", source_type="stellar_catalog", radius_km=472_680, mu_km3_s2=0.0, color="#ffd18a", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=330.8714021, dec_deg=-56.7969023, distance_pc=3.63857, exoplanet_count=1, stellar_radius_solar=0.679, stellar_teff_k=4760),
    catalog_object(key="gj-1061", name="GJ 1061", ephemeris="GJ 1061", source_type="stellar_catalog", radius_km=108_529, mu_km3_s2=0.0, color="#f08f6f", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=54.0032486, dec_deg=-44.5143104, distance_pc=3.67278, exoplanet_count=3, stellar_radius_solar=0.156, stellar_teff_k=2953),
    catalog_object(key="yz-cet", name="YZ Cet", ephemeris="YZ Cet", source_type="stellar_catalog", radius_km=109_225, mu_km3_s2=0.0, color="#f19573", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=18.1330792, dec_deg=-16.9962434, distance_pc=3.71207, exoplanet_count=3, stellar_radius_solar=0.157, stellar_teff_k=3151),
    catalog_object(key="teegardens-star", name="Teegarden's Star", ephemeris="Teegarden's Star", source_type="stellar_catalog", radius_km=83_484, mu_km3_s2=0.0, color="#f18e70", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=43.2691449, dec_deg=16.8649024, distance_pc=3.83078, exoplanet_count=3, stellar_radius_solar=0.12, stellar_teff_k=3034),
    catalog_object(key="kapteyn", name="Kapteyn", ephemeris="Kapteyn", source_type="stellar_catalog", radius_km=202_449, mu_km3_s2=0.0, color="#f5a77e", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=77.9586613, dec_deg=-45.0430198, distance_pc=3.93305, exoplanet_count=1, stellar_radius_solar=0.291, stellar_teff_k=3550),
    catalog_object(key="wolf-1061", name="Wolf 1061", ephemeris="Wolf 1061", source_type="stellar_catalog", radius_km=213_580, mu_km3_s2=0.0, color="#f4a37b", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=247.5748276, dec_deg=-12.6676866, distance_pc=4.30592, exoplanet_count=3, stellar_radius_solar=0.307, stellar_teff_k=3342),
    catalog_object(key="gj-876", name="GJ 876", ephemeris="GJ 876", source_type="stellar_catalog", radius_km=208_710, mu_km3_s2=0.0, color="#f4a078", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=343.3239737, dec_deg=-14.2665958, distance_pc=4.67517, exoplanet_count=4, stellar_radius_solar=0.3),
    catalog_object(key="gj-411", name="GJ 411", ephemeris="GJ 411", source_type="stellar_catalog", radius_km=256_394, mu_km3_s2=0.0, color="#f5aa80", object_type="star", catalog_group="nearby_exoplanet_systems", ra_deg=165.834471, dec_deg=35.972317, distance_pc=5.675773, exoplanet_count=2, stellar_radius_solar=0.3685, stellar_teff_k=3719),
]


def parse_angular_size_arcmin(value: str | None) -> tuple[float, float | None] | None:
    if not value:
        return None

    cleaned = value.strip().lower().replace("×", "x")
    parts = [part for part in re.split(r"\s*x\s*", cleaned) if part]
    values: list[float] = []
    for part in parts[:2]:
        match = re.search(r"\d+(?:\.\d+)?", part)
        if not match:
            continue
        values.append(float(match.group(0)))

    if not values:
        return None

    major = max(values)
    minor = min(values) if len(values) > 1 else None
    return major, minor


def physical_diameter_ly(distance_ly: float, angular_arcmin: float) -> float:
    angular_rad = math.radians(angular_arcmin / 60.0)
    return 2.0 * distance_ly * math.tan(angular_rad / 2.0)


def deep_sky_physical_size_payload(entry: dict[str, Any]) -> dict[str, float | str] | None:
    distance_ly = entry.get("distance_ly")
    angular_size = parse_angular_size_arcmin(str(entry.get("angular_size_arcmin") or ""))
    if distance_ly is None or angular_size is None:
        return None

    major_arcmin, minor_arcmin = angular_size
    major_diameter_ly = physical_diameter_ly(float(distance_ly), major_arcmin)
    minor_diameter_ly = physical_diameter_ly(float(distance_ly), minor_arcmin) if minor_arcmin is not None else major_diameter_ly

    return {
        "angular_major_arcmin": major_arcmin,
        "angular_minor_arcmin": minor_arcmin if minor_arcmin is not None else major_arcmin,
        "physical_diameter_ly": major_diameter_ly,
        "physical_minor_diameter_ly": minor_diameter_ly,
        "physical_size_note": "estimated from catalog angular size and distance",
    }


def load_deep_sky_catalog_objects() -> list[dict[str, Any]]:
    if not DEEP_SKY_CATALOG_PATH.exists():
        return []

    payload = json.loads(DEEP_SKY_CATALOG_PATH.read_text(encoding="utf-8"))
    objects: list[dict[str, Any]] = []
    for entry in payload.get("objects", []):
        physical_size = deep_sky_physical_size_payload(entry) or {}
        physical_diameter = physical_size.get("physical_diameter_ly")
        radius_km = float(physical_diameter) * LIGHT_YEAR_KM / 2.0 if physical_diameter is not None else 0.0
        objects.append(
            catalog_object(
                key=str(entry["key"]),
                name=str(entry["name"]),
                ephemeris=f"Messier {entry['messier']}",
                radius_km=radius_km,
                mu_km3_s2=0.0,
                color=str(entry.get("color") or "#d9b86f"),
                object_type=str(entry["object_type"]),
                catalog_group="messier_deep_sky",
                source_type="deep_sky_catalog",
                ra_deg=float(entry["ra_deg"]),
                dec_deg=float(entry["dec_deg"]),
                aliases=[str(value) for value in entry.get("aliases", [])],
                distance_ly=float(entry["distance_ly"]),
                distance_quality=str(entry.get("distance_quality") or "catalog_estimate"),
                messier=int(entry["messier"]),
                ngc=str(entry["ngc"]) if entry.get("ngc") else None,
                ic=str(entry["ic"]) if entry.get("ic") else None,
                deep_sky_type=str(entry.get("deep_sky_type") or ""),
                deep_sky_type_label=str(entry.get("deep_sky_type_label") or "Deep-sky object"),
                apparent_magnitude=float(entry["apparent_magnitude"]) if entry.get("apparent_magnitude") is not None else None,
                angular_size_arcmin=str(entry.get("angular_size_arcmin") or ""),
                constellation=str(entry.get("constellation") or ""),
                viewing_season=str(entry.get("viewing_season") or ""),
                common_name=str(entry["common_name"]) if entry.get("common_name") else None,
                observing_equipment=str(entry.get("observing_equipment") or ""),
                why_interesting=str(entry.get("why_interesting") or ""),
                angular_major_arcmin=physical_size.get("angular_major_arcmin"),
                angular_minor_arcmin=physical_size.get("angular_minor_arcmin"),
                physical_diameter_ly=physical_size.get("physical_diameter_ly"),
                physical_minor_diameter_ly=physical_size.get("physical_minor_diameter_ly"),
                physical_size_note=str(physical_size.get("physical_size_note")) if physical_size.get("physical_size_note") else None,
            )
        )
    return objects


def normalized_catalog_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def catalog_identity_tokens(objects: list[dict[str, Any]]) -> set[str]:
    tokens: set[str] = set()
    for item in objects:
        for value in [item.get("name"), *item.get("aliases", [])]:
            if value:
                token = normalized_catalog_name(str(value))
                if token:
                    tokens.add(token)
    return tokens


def load_exoplanet_system_catalog_objects() -> list[dict[str, Any]]:
    if not EXOPLANET_CATALOG_PATH.exists():
        return []

    curated_stellar_names = {
        normalized_catalog_name(str(item["name"]))
        for item in CATALOG_OBJECTS
        if item.get("source_type") == "stellar_catalog"
    }
    curated_stellar_keys = {str(item["key"]) for item in CATALOG_OBJECTS if item.get("source_type") == "stellar_catalog"}

    payload = json.loads(EXOPLANET_CATALOG_PATH.read_text(encoding="utf-8"))
    objects: list[dict[str, Any]] = []
    for entry in payload.get("systems", []):
        name = str(entry["name"])
        key = str(entry["key"])
        if key in curated_stellar_keys or normalized_catalog_name(name) in curated_stellar_names:
            continue

        stellar_radius_solar = entry.get("stellar_radius_solar")
        radius_km = float(stellar_radius_solar) * 695_700.0 if stellar_radius_solar is not None else 0.0
        objects.append(
            catalog_object(
                key=key,
                name=name,
                ephemeris=name,
                radius_km=radius_km,
                mu_km3_s2=0.0,
                color=str(entry.get("color") or "#f0c987"),
                object_type="star",
                catalog_group="exoplanet_systems",
                source_type="exoplanet_archive_system",
                ra_deg=float(entry["ra_deg"]),
                dec_deg=float(entry["dec_deg"]),
                distance_pc=float(entry["distance_pc"]),
                exoplanet_count=int(entry.get("exoplanet_count") or len(entry.get("planets", []))),
                stellar_radius_solar=stellar_radius_solar,
                stellar_teff_k=entry.get("stellar_teff_k"),
                stellar_mass_solar=entry.get("stellar_mass_solar"),
                spectral_type=entry.get("spectral_type"),
                system_star_count=entry.get("system_star_count"),
                system_planet_count=entry.get("system_planet_count"),
                system_moon_count=entry.get("system_moon_count"),
                planets=[planet for planet in entry.get("planets", []) if isinstance(planet, dict)],
                aliases=[str(value) for value in entry.get("aliases", []) if value],
                why_interesting=str(entry.get("why_interesting") or "A confirmed exoplanet host system from the NASA Exoplanet Archive."),
            )
        )
    return objects


def load_bright_star_catalog_objects(existing_objects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not BRIGHT_STAR_CATALOG_PATH.exists():
        return []

    existing_tokens = catalog_identity_tokens(existing_objects)
    payload = json.loads(BRIGHT_STAR_CATALOG_PATH.read_text(encoding="utf-8"))
    objects: list[dict[str, Any]] = []
    for entry in payload.get("stars", []):
        name = str(entry["name"])
        aliases = [str(value) for value in entry.get("aliases", []) if value]
        entry_tokens = {
            token
            for token in [normalized_catalog_name(name), *(normalized_catalog_name(alias) for alias in aliases)]
            if token
        }
        if existing_tokens.intersection(entry_tokens):
            continue

        objects.append(
            catalog_object(
                key=str(entry["key"]),
                name=name,
                ephemeris=name,
                radius_km=float(entry.get("radius_km") or 0.0),
                mu_km3_s2=0.0,
                color=str(entry.get("color") or "#f0c987"),
                object_type="star",
                catalog_group="bright_stars",
                source_type="bright_star_catalog",
                ra_deg=float(entry["ra_deg"]),
                dec_deg=float(entry["dec_deg"]),
                distance_pc=float(entry["distance_pc"]),
                parallax_mas=float(entry["parallax_mas"]),
                hip=int(entry["hip"]),
                hd=int(entry["hd"]) if entry.get("hd") is not None else None,
                stellar_radius_solar=entry.get("stellar_radius_solar"),
                stellar_teff_k=entry.get("stellar_teff_k"),
                spectral_type=entry.get("spectral_type"),
                bv_color_index=entry.get("bv_color_index"),
                absolute_magnitude=entry.get("absolute_magnitude"),
                stellar_radius_source=entry.get("stellar_radius_source"),
                apparent_magnitude=float(entry["apparent_magnitude"]),
                aliases=aliases,
                why_interesting=str(entry.get("why_interesting") or "Bright star from the Hipparcos Main Catalogue."),
            )
        )
    return objects


DEEP_SKY_CATALOG_OBJECTS = load_deep_sky_catalog_objects()
EXOPLANET_SYSTEM_CATALOG_OBJECTS = load_exoplanet_system_catalog_objects()
BRIGHT_STAR_CATALOG_OBJECTS = load_bright_star_catalog_objects([*CATALOG_OBJECTS, *EXOPLANET_SYSTEM_CATALOG_OBJECTS])
BODIES = [*CATALOG_OBJECTS, *EXOPLANET_SYSTEM_CATALOG_OBJECTS, *BRIGHT_STAR_CATALOG_OBJECTS, *DEEP_SKY_CATALOG_OBJECTS]
BODY_BY_KEY = {item["key"]: item for item in BODIES}
DEFAULT_TRAIL_BODIES = ("earth", "mars", "jupiter")
DEFAULT_TRAIL_DAYS = 365.0
DEFAULT_TRAIL_STEP_DAYS = 14.0
MIN_TRAIL_DAYS = 1.0
MAX_TRAIL_DAYS = 3650.0
MIN_TRAIL_STEP_DAYS = 1.0
MAX_TRAIL_STEP_DAYS = 365.0

_loader: Loader | None = None
_timescale: Any | None = None
_ephemeris: Any | None = None
_satellite_kernels: dict[str, Any] = {}
_horizons_vectors: dict[tuple[str, str], dict[str, float]] = {}
_kernel_lock = threading.Lock()
_cache_lock = threading.Lock()


class QueryInputError(ValueError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details


def skyfield_context() -> tuple[Any, Any]:
    global _loader, _timescale, _ephemeris
    with _kernel_lock:
        if _loader is None:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            _loader = Loader(str(DATA_DIR))
        if _timescale is None:
            _timescale = _loader.timescale()
        if _ephemeris is None:
            _ephemeris = _loader("de440s.bsp")
    return _timescale, _ephemeris


def satellite_kernel(filename: str) -> Any:
    if filename not in SATELLITE_KERNEL_URLS:
        raise RuntimeError(f"Unknown satellite kernel: {filename}")

    with _kernel_lock:
        if filename not in _satellite_kernels:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            path = DATA_DIR / filename
            if not path.exists():
                temporary_path = path.with_suffix(f"{path.suffix}.download")
                if temporary_path.exists():
                    temporary_path.unlink()
                urlretrieve(SATELLITE_KERNEL_URLS[filename], str(temporary_path))
                temporary_path.replace(path)
            _satellite_kernels[filename] = load_file(str(path))

    return _satellite_kernels[filename]


def target_for_body(item: dict[str, Any], ephemeris: Any) -> Any:
    kernel_name = item.get("kernel")
    kernel = satellite_kernel(kernel_name) if kernel_name else ephemeris
    return kernel[item["ephemeris"]]


def bucket_datetime(value: datetime, bucket_seconds: int) -> datetime:
    value = value.astimezone(timezone.utc).replace(microsecond=0)
    epoch_seconds = int(value.timestamp())
    bucketed_seconds = epoch_seconds - (epoch_seconds % bucket_seconds)
    return datetime.fromtimestamp(bucketed_seconds, timezone.utc)


def parse_timestamp(value: str | None) -> datetime:
    if not value:
        return bucket_datetime(datetime.now(timezone.utc), LIVE_TIMESTAMP_BUCKET_SECONDS)
    cleaned = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(cleaned)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def observe_payload(key: str, latitude: float, longitude: float, timestamp: datetime) -> dict[str, Any]:
    if not re.fullmatch(r"[a-zA-Z0-9._:+ -]{1,100}", key): raise QueryInputError("key is invalid")
    if not math.isfinite(latitude) or latitude < -90 or latitude > 90: raise QueryInputError("lat must be between -90 and 90")
    if not math.isfinite(longitude) or longitude < -180 or longitude > 180: raise QueryInputError("lon must be between -180 and 180")
    item = BODY_BY_KEY.get(key)
    if item is None: raise QueryInputError("unknown object key")
    timescale, ephemeris = skyfield_context(); observer = ephemeris["earth"] + wgs84.latlon(latitude, longitude)
    target = Star(ra_hours=float(item["ra_deg"])/15.0, dec_degrees=float(item["dec_deg"])) if item.get("ra_deg") is not None and item.get("dec_deg") is not None else target_for_body(item, ephemeris)
    def horizontal(at: datetime) -> tuple[float,float]:
        altitude, azimuth, _ = observer.at(timescale.from_datetime(at)).observe(target).apparent().altaz()
        return float(altitude.degrees), float(azimuth.degrees)
    altitude, azimuth = horizontal(timestamp)
    samples=[(at:=timestamp+timedelta(minutes=5*i),*horizontal(at)) for i in range(289)]
    transit=max(samples,key=lambda row:row[1]); crossings=[]
    for previous,current in zip(samples,samples[1:]):
        if previous[1]<=0<current[1] or previous[1]>=0>current[1]: crossings.append(("rise" if current[1]>previous[1] else "set",current[0]))
    rise=next((at for kind,at in crossings if kind=="rise"),None); setting=next((at for kind,at in crossings if kind=="set"),None)
    plain=(f"Above the horizon from {rise.strftime('%H:%M')} UTC; best around {transit[0].strftime('%H:%M')} UTC." if rise else f"Above the horizon now; best around {transit[0].strftime('%H:%M')} UTC." if altitude>0 else "Below the horizon during the next 24 hours from this location.")
    return {"key":key,"name":item["name"],"observed_at_utc":isoformat_utc(timestamp),"latitude_deg":latitude,"longitude_deg":longitude,"altitude_deg":altitude,"azimuth_deg":azimuth,"rise_utc":isoformat_utc(rise) if rise else None,"transit_utc":isoformat_utc(transit[0]),"set_utc":isoformat_utc(setting) if setting else None,"summary":plain,"accuracy_note":"Geometric five-minute sampling; refraction and local obstructions are not modeled."}


def cache_key_payload(kind: str, **parts: Any) -> dict[str, Any]:
    return {
        "schema_version": CACHE_SCHEMA_VERSION,
        "kind": kind,
        **parts,
    }


def cache_path(namespace: str, key: dict[str, Any]) -> Path:
    serialized = json.dumps(key, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return CACHE_DIR / namespace / f"{digest}.json"


def read_cache(namespace: str, key: dict[str, Any]) -> dict[str, Any] | None:
    path = cache_path(namespace, key)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def write_cache(namespace: str, key: dict[str, Any], payload: dict[str, Any]) -> None:
    path = cache_path(namespace, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(".json.tmp")
    temporary_path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    temporary_path.replace(path)


def cached_payload(namespace: str, key: dict[str, Any], builder: Any) -> dict[str, Any]:
    with _cache_lock:
        cached = read_cache(namespace, key)
        if cached is not None:
            return payload_with_cache_metadata(cached, True, namespace)

        payload = builder()
        write_cache(namespace, key, payload)
        return payload_with_cache_metadata(payload, False, namespace)


def payload_with_cache_metadata(payload: dict[str, Any], hit: bool, namespace: str) -> dict[str, Any]:
    return {
        **payload,
        "cache": {
            "hit": hit,
            "namespace": namespace,
            "schema_version": CACHE_SCHEMA_VERSION,
            "live_timestamp_bucket_seconds": LIVE_TIMESTAMP_BUCKET_SECONDS,
        },
    }


def vector_payload(vector: Any) -> dict[str, float]:
    xyz_au = vector.frame_xyz(ecliptic_frame).au
    return {
        "x_au": float(xyz_au[0]),
        "y_au": float(xyz_au[1]),
        "z_au": float(xyz_au[2]),
        "x_km": float(xyz_au[0] * AU_KM),
        "y_km": float(xyz_au[1] * AU_KM),
        "z_km": float(xyz_au[2] * AU_KM),
        "heliocentric_distance_km": float(vector.distance().km),
    }


def horizons_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%b-%d %H:%M:%S")


def horizons_center_for_item(item: dict[str, Any]) -> str:
    parent_key = item.get("parent_key")
    return HORIZONS_PARENT_CENTERS.get(parent_key, "@sun")


def radec_distance_position_payload(item: dict[str, Any]) -> dict[str, float]:
    ra_deg = item.get("ra_deg")
    dec_deg = item.get("dec_deg")
    distance_pc = item.get("distance_pc")
    distance_ly = item.get("distance_ly")
    if distance_pc is None and distance_ly is not None:
        distance_pc = float(distance_ly) / 3.261563777
    if ra_deg is None or dec_deg is None or distance_pc is None:
        raise RuntimeError(f"Static catalog object {item['name']} requires RA, Dec, and distance")

    distance_au = float(distance_pc) * PARSEC_AU
    ra_rad = math.radians(float(ra_deg))
    dec_rad = math.radians(float(dec_deg))
    equatorial_x_au = distance_au * math.cos(dec_rad) * math.cos(ra_rad)
    equatorial_y_au = distance_au * math.cos(dec_rad) * math.sin(ra_rad)
    equatorial_z_au = distance_au * math.sin(dec_rad)

    obliquity_rad = math.radians(23.4392911)
    x_au = equatorial_x_au
    y_au = equatorial_y_au * math.cos(obliquity_rad) + equatorial_z_au * math.sin(obliquity_rad)
    z_au = -equatorial_y_au * math.sin(obliquity_rad) + equatorial_z_au * math.cos(obliquity_rad)

    return {
        "x_au": x_au,
        "y_au": y_au,
        "z_au": z_au,
        "x_km": x_au * AU_KM,
        "y_km": y_au * AU_KM,
        "z_km": z_au * AU_KM,
        "heliocentric_distance_km": distance_au * AU_KM,
        "distance_pc": float(distance_pc),
        "distance_ly": distance_au * AU_KM / LIGHT_YEAR_KM,
        "ra_deg": float(ra_deg),
        "dec_deg": float(dec_deg),
    }


def stellar_catalog_position_payload(item: dict[str, Any]) -> dict[str, float]:
    return radec_distance_position_payload(item)


def stellar_catalog_payload(item: dict[str, Any]) -> dict[str, Any]:
    distance_pc = item.get("distance_pc")
    return {
        "ra_deg": item.get("ra_deg"),
        "dec_deg": item.get("dec_deg"),
        "distance_pc": distance_pc,
        "distance_ly": float(distance_pc) * PARSEC_AU * AU_KM / LIGHT_YEAR_KM if distance_pc is not None else None,
        "parallax_mas": item.get("parallax_mas"),
        "hip": item.get("hip"),
        "hd": item.get("hd"),
        "apparent_magnitude": item.get("apparent_magnitude"),
        "absolute_magnitude": item.get("absolute_magnitude"),
        "bv_color_index": item.get("bv_color_index"),
        "exoplanet_count": item.get("exoplanet_count"),
        "stellar_radius_solar": item.get("stellar_radius_solar"),
        "stellar_teff_k": item.get("stellar_teff_k"),
        "stellar_mass_solar": item.get("stellar_mass_solar"),
        "spectral_type": item.get("spectral_type"),
        "stellar_radius_source": item.get("stellar_radius_source"),
    }


def exoplanet_system_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": "NASA Exoplanet Archive Planetary Systems Composite Parameters",
        "system_star_count": item.get("system_star_count"),
        "system_planet_count": item.get("system_planet_count"),
        "system_moon_count": item.get("system_moon_count"),
        "confirmed_planet_count": item.get("exoplanet_count"),
        "planets": item.get("planets", []),
        "why_interesting": item.get("why_interesting"),
    }


def deep_sky_catalog_position_payload(item: dict[str, Any]) -> dict[str, float]:
    return radec_distance_position_payload(item)


def deep_sky_catalog_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "messier": item.get("messier"),
        "ngc": item.get("ngc"),
        "ic": item.get("ic"),
        "aliases": item.get("aliases", []),
        "ra_deg": item.get("ra_deg"),
        "dec_deg": item.get("dec_deg"),
        "distance_ly": item.get("distance_ly"),
        "distance_quality": item.get("distance_quality"),
        "deep_sky_type": item.get("deep_sky_type"),
        "deep_sky_type_label": item.get("deep_sky_type_label"),
        "apparent_magnitude": item.get("apparent_magnitude"),
        "angular_size_arcmin": item.get("angular_size_arcmin"),
        "angular_major_arcmin": item.get("angular_major_arcmin"),
        "angular_minor_arcmin": item.get("angular_minor_arcmin"),
        "physical_diameter_ly": item.get("physical_diameter_ly"),
        "physical_minor_diameter_ly": item.get("physical_minor_diameter_ly"),
        "physical_size_note": item.get("physical_size_note"),
        "constellation": item.get("constellation"),
        "viewing_season": item.get("viewing_season"),
        "common_name": item.get("common_name"),
        "observing_equipment": item.get("observing_equipment"),
        "why_interesting": item.get("why_interesting"),
    }


def horizons_vector_payload(item: dict[str, Any], timestamp: datetime) -> dict[str, float]:
    horizons_id = item.get("horizons_id")
    if not horizons_id:
        raise RuntimeError(f"{item['key']} is not configured for Horizons vectors")

    timestamp_key = timestamp.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    center = horizons_center_for_item(item)
    cache_key = (f"{horizons_id}@{center}", timestamp_key)
    cached = _horizons_vectors.get(cache_key)
    if cached is not None:
        return cached

    disk_cache_key = cache_key_payload(
        "horizons_vector",
        horizons_id=str(horizons_id),
        center=center,
        timestamp_utc=timestamp_key,
    )
    disk_cached = read_cache("horizons", disk_cache_key)
    if disk_cached is not None:
        _horizons_vectors[cache_key] = disk_cached
        return disk_cached

    stop_timestamp = timestamp + timedelta(minutes=1)
    query = urlencode(
        {
            "format": "json",
            "COMMAND": f"'{horizons_id}'",
            "EPHEM_TYPE": "VECTORS",
            "CENTER": f"'{center}'",
            "REF_PLANE": "ECLIPTIC",
            "REF_SYSTEM": "ICRF",
            "OUT_UNITS": "KM-S",
            "VEC_TABLE": "2",
            "START_TIME": f"'{horizons_timestamp(timestamp)}'",
            "STOP_TIME": f"'{horizons_timestamp(stop_timestamp)}'",
            "STEP_SIZE": "'1 d'",
        }
    )
    url = f"https://ssd.jpl.nasa.gov/api/horizons.api?{query}"
    with urlopen(url, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if payload.get("error"):
        raise RuntimeError(f"Horizons API error for {item['name']}: {payload['error']}")

    result = str(payload.get("result", ""))
    x_match = re.search(r"X\s*=\s*([+-]?\d+\.\d+E[+-]\d+)", result)
    y_match = re.search(r"Y\s*=\s*([+-]?\d+\.\d+E[+-]\d+)", result)
    z_match = re.search(r"Z\s*=\s*([+-]?\d+\.\d+E[+-]\d+)", result)
    vx_match = re.search(r"VX\s*=\s*([+-]?\d+\.\d+E[+-]\d+)", result)
    vy_match = re.search(r"VY\s*=\s*([+-]?\d+\.\d+E[+-]\d+)", result)
    vz_match = re.search(r"VZ\s*=\s*([+-]?\d+\.\d+E[+-]\d+)", result)
    if not x_match or not y_match or not z_match or not vx_match or not vy_match or not vz_match:
        raise RuntimeError(f"Horizons API did not return vector coordinates for {item['name']}")

    x_km = float(x_match.group(1))
    y_km = float(y_match.group(1))
    z_km = float(z_match.group(1))
    position = {
        "x_au": x_km / AU_KM,
        "y_au": y_km / AU_KM,
        "z_au": z_km / AU_KM,
        "x_km": x_km,
        "y_km": y_km,
        "z_km": z_km,
        "vx_km_s": float(vx_match.group(1)),
        "vy_km_s": float(vy_match.group(1)),
        "vz_km_s": float(vz_match.group(1)),
        "heliocentric_distance_km": math.sqrt(x_km * x_km + y_km * y_km + z_km * z_km),
    }
    _horizons_vectors[cache_key] = position
    write_cache("horizons", disk_cache_key, position)
    return position


def add_relative_position(origin: dict[str, float], relative: dict[str, float]) -> dict[str, float]:
    x_km = origin["x_km"] + relative["x_km"]
    y_km = origin["y_km"] + relative["y_km"]
    z_km = origin["z_km"] + relative["z_km"]
    return {
        "x_au": x_km / AU_KM,
        "y_au": y_km / AU_KM,
        "z_au": z_km / AU_KM,
        "x_km": x_km,
        "y_km": y_km,
        "z_km": z_km,
        "heliocentric_distance_km": math.sqrt(x_km * x_km + y_km * y_km + z_km * z_km),
    }


def isoformat_utc(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def parse_float_param(query: dict[str, list[str]], name: str, default: float) -> float:
    raw_value = query.get(name, [None])[0]
    if raw_value is None or raw_value.strip() == "":
        return default

    try:
        value = float(raw_value)
    except ValueError as exc:
        raise QueryInputError(f"{name} must be a number") from exc

    if not math.isfinite(value):
        raise QueryInputError(f"{name} must be a finite number")

    return value


def parse_catalog_groups(query: dict[str, list[str]], default_groups: tuple[str, ...] = DEFAULT_CATALOG_GROUPS) -> list[str]:
    raw_values = query.get("groups")
    if raw_values is None:
        return list(default_groups)

    groups = [
        part.strip().lower()
        for value in raw_values
        for part in value.split(",")
        if part.strip()
    ]
    if not groups:
        return []

    invalid_groups = [group for group in groups if group not in CATALOG_GROUPS]
    if invalid_groups:
        raise QueryInputError(
            "Unknown catalog group",
            details={
                "invalid_groups": invalid_groups,
                "valid_groups": list(CATALOG_GROUPS.keys()),
            },
        )

    selected_groups: list[str] = []
    seen_groups: set[str] = set()
    for group in groups:
        if group not in seen_groups:
            selected_groups.append(group)
            seen_groups.add(group)
    return selected_groups


def parse_catalog_keys(query: dict[str, list[str]]) -> list[str]:
    raw_values = query.get("keys")
    if raw_values is None:
        return []

    keys = [
        part.strip().lower()
        for value in raw_values
        for part in value.split(",")
        if part.strip()
    ]
    invalid_keys = [key for key in keys if key not in BODY_BY_KEY]
    if invalid_keys:
        raise QueryInputError(
            "Unknown object key",
            details={
                "invalid_keys": invalid_keys,
            },
        )

    selected_keys: list[str] = []
    seen_keys: set[str] = set()
    for key in keys:
        if key not in seen_keys:
            selected_keys.append(key)
            seen_keys.add(key)
    return selected_keys


def parse_catalog_object_types(query: dict[str, list[str]]) -> list[str]:
    raw_values = query.get("types")
    if raw_values is None:
        return []

    object_types = [
        part.strip().lower()
        for value in raw_values
        for part in value.split(",")
        if part.strip()
    ]
    selected_types: list[str] = []
    seen_types: set[str] = set()
    for object_type in object_types:
        if object_type not in seen_types:
            selected_types.append(object_type)
            seen_types.add(object_type)
    return selected_types


def parse_int_param(query: dict[str, list[str]], name: str, default: int, minimum: int, maximum: int) -> int:
    raw_value = query.get(name, [None])[0]
    if raw_value is None or raw_value.strip() == "":
        return default

    try:
        value = int(raw_value)
    except ValueError as exc:
        raise QueryInputError(f"{name} must be an integer") from exc

    return min(max(value, minimum), maximum)


def parse_bool_param(query: dict[str, list[str]], name: str, default: bool) -> bool:
    raw_value = query.get(name, [None])[0]
    if raw_value is None or raw_value.strip() == "":
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def catalog_objects_for_groups(groups: list[str]) -> list[dict[str, Any]]:
    group_set = set(groups)
    return [item for item in BODIES if item["catalog_group"] in group_set]


def catalog_objects_for_selection(groups: list[str], keys: list[str] | None = None) -> list[dict[str, Any]]:
    objects = catalog_objects_for_groups(groups)
    seen_keys = {str(item["key"]) for item in objects}
    for key in keys or []:
        if key in seen_keys:
            continue
        objects.append(BODY_BY_KEY[key])
        seen_keys.add(key)
    return objects


def catalog_object_payload(item: dict[str, Any]) -> dict[str, Any]:
    source_type = item.get("source_type") or "spk"
    if source_type == "horizons":
        ephemeris_kernel = "JPL Horizons vectors"
        ephemeris_source = "NASA/JPL Horizons API"
        position_model = "horizons_vectors"
    elif source_type == "stellar_catalog":
        ephemeris_kernel = "NASA Exoplanet Archive"
        ephemeris_source = "NASA Exoplanet Archive confirmed planet host catalog"
        position_model = "stellar_catalog_coordinates"
    elif source_type == "exoplanet_archive_system":
        ephemeris_kernel = "NASA Exoplanet Archive PSCompPars snapshot"
        ephemeris_source = "NASA Exoplanet Archive Planetary Systems Composite Parameters"
        position_model = "exoplanet_archive_coordinates"
    elif source_type == "bright_star_catalog":
        ephemeris_kernel = "Hipparcos Main Catalogue"
        ephemeris_source = "CDS/VizieR Hipparcos Main Catalogue"
        position_model = "hipparcos_catalog_coordinates"
    elif source_type == "deep_sky_catalog":
        ephemeris_kernel = "generated Messier deep-sky snapshot"
        ephemeris_source = "AstroPixels Messier table with NASA HEASARC catalog context"
        position_model = "deep_sky_catalog_coordinates"
    else:
        ephemeris_kernel = item.get("kernel") or "de440s.bsp"
        ephemeris_source = "NAIF satellite SPK" if item.get("kernel") else "NASA/JPL DE440s"
        position_model = "spice_spk"

    return {
        "key": item["key"],
        "name": item["name"],
        "object_type": item["object_type"],
        "parent_key": item.get("parent_key"),
        "catalog_group": item["catalog_group"],
        "catalog_group_label": CATALOG_GROUPS[item["catalog_group"]]["label"],
        "ephemeris_id": str(item.get("horizons_id") or item["ephemeris"]),
        "ephemeris_kernel": ephemeris_kernel,
        "ephemeris_source": ephemeris_source,
        "ephemeris_center": horizons_center_for_item(item) if source_type == "horizons" else "Sun" if source_type in STATIC_CATALOG_SOURCE_TYPES else "solar-system barycenter",
        "position_model": position_model,
        "dynamic_position": source_type not in STATIC_CATALOG_SOURCE_TYPES,
        "aliases": item.get("aliases", []),
        "ra_deg": item.get("ra_deg"),
        "dec_deg": item.get("dec_deg"),
        "distance_pc": item.get("distance_pc"),
        "distance_ly": item.get("distance_ly"),
        "parallax_mas": item.get("parallax_mas"),
        "hip": item.get("hip"),
        "hd": item.get("hd"),
        "exoplanet_count": item.get("exoplanet_count"),
        "stellar_radius_solar": item.get("stellar_radius_solar"),
        "stellar_teff_k": item.get("stellar_teff_k"),
        "stellar_mass_solar": item.get("stellar_mass_solar"),
        "spectral_type": item.get("spectral_type"),
        "bv_color_index": item.get("bv_color_index"),
        "absolute_magnitude": item.get("absolute_magnitude"),
        "stellar_radius_source": item.get("stellar_radius_source"),
        "system_star_count": item.get("system_star_count"),
        "system_planet_count": item.get("system_planet_count"),
        "system_moon_count": item.get("system_moon_count"),
        "messier": item.get("messier"),
        "ngc": item.get("ngc"),
        "ic": item.get("ic"),
        "deep_sky_type": item.get("deep_sky_type"),
        "deep_sky_type_label": item.get("deep_sky_type_label"),
        "apparent_magnitude": item.get("apparent_magnitude"),
        "angular_size_arcmin": item.get("angular_size_arcmin"),
        "angular_major_arcmin": item.get("angular_major_arcmin"),
        "angular_minor_arcmin": item.get("angular_minor_arcmin"),
        "physical_diameter_ly": item.get("physical_diameter_ly"),
        "physical_minor_diameter_ly": item.get("physical_minor_diameter_ly"),
        "physical_size_note": item.get("physical_size_note"),
        "constellation": item.get("constellation"),
        "viewing_season": item.get("viewing_season"),
        "common_name": item.get("common_name"),
        "observing_equipment": item.get("observing_equipment"),
        "why_interesting": item.get("why_interesting"),
    }


def catalog_summary_payload(groups: list[str], objects: list[dict[str, Any]], include_objects: bool = True) -> dict[str, Any]:
    kernels = sorted({
        item.get("kernel")
        or (
            "JPL Horizons vectors"
            if item.get("source_type") == "horizons"
            else "Messier deep-sky snapshot"
            if item.get("source_type") == "deep_sky_catalog"
            else "NASA Exoplanet Archive PSCompPars snapshot"
            if item.get("source_type") == "exoplanet_archive_system"
            else "Hipparcos Main Catalogue"
            if item.get("source_type") == "bright_star_catalog"
            else "NASA Exoplanet Archive"
            if item.get("source_type") == "stellar_catalog"
            else "de440s.bsp"
        )
        for item in objects
    })
    return {
        "schema_version": 1,
        "groups": groups,
        "available_groups": [
            {"key": key, "label": value["label"], "description": value["description"]}
            for key, value in CATALOG_GROUPS.items()
        ],
        "object_count": len(objects),
        "group_counts": {
            key: sum(1 for item in objects if item["catalog_group"] == key)
            for key in CATALOG_GROUPS
        },
        "kernels": kernels,
        "objects": [catalog_object_payload(item) for item in objects] if include_objects else [],
        "notes": [
            "Catalog records are separate from rendered ephemeris state so future object classes can be lazy-loaded.",
            "Loaded Solar System records use dynamic SPK or Horizons vector positions.",
        ],
    }


def normalized_search_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def catalog_search_tokens(item: dict[str, Any]) -> list[str]:
    values: list[Any] = [
        item.get("key"),
        item.get("name"),
        item.get("object_type"),
        item.get("catalog_group"),
        CATALOG_GROUPS[item["catalog_group"]]["label"],
        item.get("deep_sky_type_label"),
        item.get("common_name"),
        item.get("constellation"),
        item.get("spectral_type"),
        item.get("why_interesting"),
        *(item.get("aliases") or []),
    ]
    for planet in item.get("planets") or []:
        if isinstance(planet, dict):
            values.extend([planet.get("name"), planet.get("discovery_method")])
    tokens: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = normalized_search_text(value)
        if text and text not in seen:
            tokens.append(text)
            seen.add(text)
    return tokens


def catalog_search_score(item: dict[str, Any], query: str) -> int | None:
    query_parts = [part for part in normalized_search_text(query).split(" ") if part]
    if not query_parts:
        return 0

    tokens = catalog_search_tokens(item)
    total = 0
    for part in query_parts:
        part_score = 0
        for token in tokens:
            if token == part:
                part_score = max(part_score, 120)
            elif token.startswith(part):
                part_score = max(part_score, 80)
            elif part in token:
                part_score = max(part_score, 35)
        if part_score == 0:
            return None
        total += part_score

    name = normalized_search_text(item.get("name"))
    key = normalized_search_text(item.get("key"))
    normalized_query = normalized_search_text(query)
    if name == normalized_query:
        total += 320
    elif name.startswith(normalized_query):
        total += 140
    if key == normalized_query:
        total += 260
    elif key.startswith(normalized_query):
        total += 100

    return total


def catalog_base_sort_key(item: dict[str, Any]) -> tuple[float, str]:
    magnitude = item.get("apparent_magnitude")
    if isinstance(magnitude, (int, float)) and math.isfinite(float(magnitude)):
        return (float(magnitude), str(item["name"]).lower())
    return (99.0, str(item["name"]).lower())


def filtered_catalog_objects(groups: list[str], object_types: list[str], query_text: str) -> list[dict[str, Any]]:
    objects = catalog_objects_for_groups(groups)
    if object_types:
        type_set = set(object_types)
        objects = [item for item in objects if str(item.get("object_type") or "").lower() in type_set]

    if query_text.strip():
        scored: list[tuple[int, dict[str, Any]]] = []
        for item in objects:
            score = catalog_search_score(item, query_text)
            if score is not None:
                scored.append((score, item))
        return [
            item
            for score, item in sorted(
                scored,
                key=lambda pair: (-pair[0], catalog_base_sort_key(pair[1])),
            )
        ]

    return sorted(objects, key=catalog_base_sort_key)


def catalog_search_payload(
    timestamp: datetime,
    groups: list[str],
    object_types: list[str],
    query_text: str,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    matches = filtered_catalog_objects(groups, object_types, query_text)
    page_objects = matches[offset : offset + limit]
    bodies, earth_position = body_payloads(timestamp, page_objects)
    return {
        "schema_version": 1,
        "timestamp_utc": isoformat_utc(timestamp),
        "generated_at_utc": isoformat_utc(datetime.now(timezone.utc)),
        "query": query_text,
        "groups": groups,
        "types": object_types,
        "offset": offset,
        "limit": limit,
        "total": len(matches),
        "has_more": offset + limit < len(matches),
        "au_km": AU_KM,
        "earth_position": earth_position,
        "bodies": bodies,
    }


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def parse_trail_body_keys(values: list[str] | None) -> list[str]:
    if values is None:
        return list(DEFAULT_TRAIL_BODIES)

    body_keys = [
        part.strip().lower()
        for value in values
        for part in value.split(",")
        if part.strip()
    ]
    if not body_keys:
        raise QueryInputError("bodies must include at least one body key")

    invalid_keys = [key for key in body_keys if key not in BODY_BY_KEY]
    if invalid_keys:
        raise QueryInputError(
            "Unknown body key",
            details={
                "invalid_bodies": invalid_keys,
                "valid_bodies": [item["key"] for item in BODIES],
            },
        )

    selected_keys: list[str] = []
    seen_keys: set[str] = set()
    for key in body_keys:
        if key not in seen_keys:
            selected_keys.append(key)
            seen_keys.add(key)
    return selected_keys


def parse_trails_query(
    query: dict[str, list[str]],
) -> tuple[datetime, list[str], float, float, dict[str, Any]]:
    try:
        timestamp = parse_timestamp(query.get("timestamp", [None])[0])
    except ValueError as exc:
        raise QueryInputError("timestamp must be an ISO-8601 datetime") from exc

    body_keys = parse_trail_body_keys(query.get("bodies"))
    requested_days = parse_float_param(query, "days", DEFAULT_TRAIL_DAYS)
    days = clamp_float(requested_days, MIN_TRAIL_DAYS, MAX_TRAIL_DAYS)

    requested_step_days = parse_float_param(query, "step_days", DEFAULT_TRAIL_STEP_DAYS)
    step_days = clamp_float(requested_step_days, MIN_TRAIL_STEP_DAYS, min(MAX_TRAIL_STEP_DAYS, days))

    return (
        timestamp,
        body_keys,
        days,
        step_days,
        {
            "requested_days": requested_days,
            "requested_step_days": requested_step_days,
            "clamped": requested_days != days or requested_step_days != step_days,
        },
    )


def trail_sample_datetimes(timestamp: datetime, days: float, step_days: float) -> list[tuple[datetime, float]]:
    half_days = days / 2.0
    step_count_each_side = int(math.floor(half_days / step_days))
    offsets = [-half_days, 0.0, half_days]
    for index in range(1, step_count_each_side + 1):
        offset = step_days * index
        offsets.extend((-offset, offset))

    unique_offsets: list[float] = []
    for offset in sorted(offsets):
        if not unique_offsets or not math.isclose(unique_offsets[-1], offset, rel_tol=0.0, abs_tol=1e-9):
            unique_offsets.append(offset)

    return [(timestamp + timedelta(days=offset_days), offset_days) for offset_days in unique_offsets]


def zero_trail_point(timestamp: datetime, offset_days: float) -> dict[str, float | str]:
    return {
        "timestamp_utc": isoformat_utc(timestamp),
        "offset_days": float(offset_days),
        "x_au": 0.0,
        "y_au": 0.0,
        "z_au": 0.0,
        "x_km": 0.0,
        "y_km": 0.0,
        "z_km": 0.0,
        "heliocentric_distance_km": 0.0,
    }


def trail_points_from_vector(vector: Any, samples: list[tuple[datetime, float]]) -> list[dict[str, float | str]]:
    xyz_au = vector.frame_xyz(ecliptic_frame).au
    distance_km = vector.distance().km

    points: list[dict[str, float | str]] = []
    for index, (sample_timestamp, offset_days) in enumerate(samples):
        x_au = float(xyz_au[0][index])
        y_au = float(xyz_au[1][index])
        z_au = float(xyz_au[2][index])
        points.append(
            {
                "timestamp_utc": isoformat_utc(sample_timestamp),
                "offset_days": float(offset_days),
                "x_au": x_au,
                "y_au": y_au,
                "z_au": z_au,
                "x_km": float(x_au * AU_KM),
                "y_km": float(y_au * AU_KM),
                "z_km": float(z_au * AU_KM),
                "heliocentric_distance_km": float(distance_km[index]),
            }
        )

    return points


def vector3_sub(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vector3_scale(value: tuple[float, float, float], scalar: float) -> tuple[float, float, float]:
    return (value[0] * scalar, value[1] * scalar, value[2] * scalar)


def vector3_dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vector3_cross(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def vector3_norm(value: tuple[float, float, float]) -> float:
    return math.sqrt(vector3_dot(value, value))


def angle_0_360_deg(radians: float) -> float:
    return float(math.degrees(radians) % 360.0)


def vector_components(value: tuple[float, float, float]) -> dict[str, float]:
    return {"x": float(value[0]), "y": float(value[1]), "z": float(value[2])}


def safe_float(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return float(value)


def body_state(
    body_key: str,
    timestamp: datetime,
    cache: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cache_key = (body_key, isoformat_utc(timestamp))
    if cache is not None and cache_key in cache:
        return cache[cache_key]

    timescale, ephemeris = skyfield_context()
    time = timescale.from_datetime(timestamp)
    item = BODY_BY_KEY[body_key]
    sun = ephemeris["sun"]

    if body_key == "sun":
        position_au = (0.0, 0.0, 0.0)
        position_km = (0.0, 0.0, 0.0)
        velocity_km_s = (0.0, 0.0, 0.0)
    elif item.get("source_type") in STATIC_CATALOG_SOURCE_TYPES:
        position = radec_distance_position_payload(item)
        position_au = (float(position["x_au"]), float(position["y_au"]), float(position["z_au"]))
        position_km = (float(position["x_km"]), float(position["y_km"]), float(position["z_km"]))
        velocity_km_s = (0.0, 0.0, 0.0)
    elif item.get("source_type") == "horizons":
        parent_key = item.get("parent_key")
        if not parent_key:
            raise RuntimeError(f"Horizons object {item['name']} requires a parent")
        parent_state = body_state(parent_key, timestamp, cache)
        vector = horizons_vector_payload(item, timestamp)
        position_km = (
            float(parent_state["position_km"][0] + vector["x_km"]),
            float(parent_state["position_km"][1] + vector["y_km"]),
            float(parent_state["position_km"][2] + vector["z_km"]),
        )
        position_au = tuple(component / AU_KM for component in position_km)
        velocity_km_s = (
            float(parent_state["velocity_km_s"][0] + vector["vx_km_s"]),
            float(parent_state["velocity_km_s"][1] + vector["vy_km_s"]),
            float(parent_state["velocity_km_s"][2] + vector["vz_km_s"]),
        )
    else:
        target = target_for_body(item, ephemeris)
        xyz, velocity = (target - sun).at(time).frame_xyz_and_velocity(ecliptic_frame)
        position_au = (float(xyz.au[0]), float(xyz.au[1]), float(xyz.au[2]))
        position_km = tuple(component * AU_KM for component in position_au)
        velocity_km_s = (float(velocity.km_per_s[0]), float(velocity.km_per_s[1]), float(velocity.km_per_s[2]))

    payload = {
        "key": item["key"],
        "name": item["name"],
        "timestamp_utc": isoformat_utc(timestamp),
        "position_au": position_au,
        "position_km": position_km,
        "velocity_km_s": velocity_km_s,
        "radius_km": float(item["radius_km"]),
        "mu_km3_s2": float(item["mu_km3_s2"]),
        "color": item["color"],
    }
    if cache is not None:
        cache[cache_key] = payload
    return payload


def body_state_vector_payload(
    item: dict[str, Any],
    timestamp: datetime,
    cache: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    state = body_state(item["key"], timestamp, cache)
    parent_key = item.get("parent_key")
    if parent_key:
        parent_state = body_state(parent_key, timestamp, cache)
        relative_position = vector3_sub(state["position_km"], parent_state["position_km"])
        relative_velocity = vector3_sub(state["velocity_km_s"], parent_state["velocity_km_s"])
        relative_to_name = parent_state["name"]
    else:
        relative_position = state["position_km"]
        relative_velocity = state["velocity_km_s"]
        relative_to_name = None

    return {
        "frame": "parent-centered ecliptic Cartesian" if parent_key else "heliocentric ecliptic Cartesian",
        "relative_to_key": parent_key,
        "relative_to_name": relative_to_name,
        "position_km": vector_components(relative_position),
        "velocity_km_s": vector_components(relative_velocity),
        "distance_km": float(vector3_norm(relative_position)),
        "speed_km_s": float(vector3_norm(relative_velocity)),
        "heliocentric_velocity_km_s": vector_components(state["velocity_km_s"]),
        "heliocentric_speed_km_s": float(vector3_norm(state["velocity_km_s"])),
    }


def orbit_class(eccentricity: float, semi_major_axis_km: float | None) -> str:
    if eccentricity < 1e-4:
        return "near-circular"
    if eccentricity < 1.0:
        return "elliptic"
    if math.isclose(eccentricity, 1.0, rel_tol=0.0, abs_tol=1e-3):
        return "near-parabolic"
    if semi_major_axis_km is not None and semi_major_axis_km < 0:
        return "hyperbolic"
    return "open"


def osculating_elements_from_state(
    relative_position_km: tuple[float, float, float],
    relative_velocity_km_s: tuple[float, float, float],
    central_mu_km3_s2: float,
) -> dict[str, Any] | None:
    r_norm = vector3_norm(relative_position_km)
    v_norm = vector3_norm(relative_velocity_km_s)
    if central_mu_km3_s2 <= 0 or r_norm <= 0 or v_norm <= 0:
        return None

    h_vec = vector3_cross(relative_position_km, relative_velocity_km_s)
    h_norm = vector3_norm(h_vec)
    if h_norm <= 0:
        return None

    node_vec = vector3_cross((0.0, 0.0, 1.0), h_vec)
    node_norm = vector3_norm(node_vec)
    eccentricity_vec = vector3_sub(
        vector3_scale(vector3_cross(relative_velocity_km_s, h_vec), 1.0 / central_mu_km3_s2),
        vector3_scale(relative_position_km, 1.0 / r_norm),
    )
    eccentricity = vector3_norm(eccentricity_vec)
    specific_energy = (v_norm * v_norm) / 2.0 - central_mu_km3_s2 / r_norm
    semi_major_axis_km = -central_mu_km3_s2 / (2.0 * specific_energy) if abs(specific_energy) > 1e-12 else None
    semi_latus_rectum_km = (h_norm * h_norm) / central_mu_km3_s2

    inclination_deg = angle_0_360_deg(math.acos(clamp_float(h_vec[2] / h_norm, -1.0, 1.0)))
    longitude_of_ascending_node_deg = angle_0_360_deg(math.atan2(node_vec[1], node_vec[0])) if node_norm > 1e-9 else None

    argument_of_periapsis_deg = None
    if node_norm > 1e-9 and eccentricity > 1e-9:
        argument = math.acos(clamp_float(vector3_dot(node_vec, eccentricity_vec) / (node_norm * eccentricity), -1.0, 1.0))
        if eccentricity_vec[2] < 0:
            argument = (2.0 * math.pi) - argument
        argument_of_periapsis_deg = angle_0_360_deg(argument)

    true_anomaly_deg = None
    if eccentricity > 1e-9:
        anomaly = math.acos(clamp_float(vector3_dot(eccentricity_vec, relative_position_km) / (eccentricity * r_norm), -1.0, 1.0))
        if vector3_dot(relative_position_km, relative_velocity_km_s) < 0:
            anomaly = (2.0 * math.pi) - anomaly
        true_anomaly_deg = angle_0_360_deg(anomaly)
    elif node_norm > 1e-9:
        argument_latitude = math.acos(clamp_float(vector3_dot(node_vec, relative_position_km) / (node_norm * r_norm), -1.0, 1.0))
        if relative_position_km[2] < 0:
            argument_latitude = (2.0 * math.pi) - argument_latitude
        true_anomaly_deg = angle_0_360_deg(argument_latitude)

    periapsis_km = semi_latus_rectum_km / (1.0 + eccentricity) if eccentricity > -1.0 else None
    apoapsis_km = None
    orbital_period_days = None
    mean_motion_deg_per_day = None
    if semi_major_axis_km is not None and semi_major_axis_km > 0 and eccentricity < 1.0:
        apoapsis_km = semi_major_axis_km * (1.0 + eccentricity)
        orbital_period_seconds = 2.0 * math.pi * math.sqrt((semi_major_axis_km**3) / central_mu_km3_s2)
        orbital_period_days = orbital_period_seconds / SECONDS_PER_DAY
        mean_motion_deg_per_day = 360.0 / orbital_period_days if orbital_period_days > 0 else None

    notes: list[str] = [
        "Osculating elements are derived from the instantaneous parent-relative state vector at this epoch.",
        "They are not stored catalog elements and will change with epoch, perturbations, and reference frame.",
    ]
    if eccentricity < 1e-4:
        notes.append("Argument of periapsis is weakly defined for near-circular orbits.")
    if node_norm <= 1e-9:
        notes.append("Ascending node is weakly defined for near-zero inclination orbits.")

    return {
        "source": "derived_from_state_vector",
        "semi_major_axis_km": safe_float(semi_major_axis_km),
        "eccentricity": float(eccentricity),
        "inclination_deg": safe_float(inclination_deg),
        "longitude_of_ascending_node_deg": safe_float(longitude_of_ascending_node_deg),
        "argument_of_periapsis_deg": safe_float(argument_of_periapsis_deg),
        "true_anomaly_deg": safe_float(true_anomaly_deg),
        "periapsis_km": safe_float(periapsis_km),
        "apoapsis_km": safe_float(apoapsis_km),
        "orbital_period_days": safe_float(orbital_period_days),
        "mean_motion_deg_per_day": safe_float(mean_motion_deg_per_day),
        "specific_orbital_energy_km2_s2": float(specific_energy),
        "specific_angular_momentum_km2_s": float(h_norm),
        "orbit_class": orbit_class(eccentricity, semi_major_axis_km),
        "notes": notes,
    }


def orbit_payload_for_item(
    item: dict[str, Any],
    timestamp: datetime,
    cache: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any] | None:
    parent_key = item.get("parent_key")
    if not parent_key:
        return None

    state = body_state(item["key"], timestamp, cache)
    parent_state = body_state(parent_key, timestamp, cache)
    relative_position = vector3_sub(state["position_km"], parent_state["position_km"])
    relative_velocity = vector3_sub(state["velocity_km_s"], parent_state["velocity_km_s"])
    central_mu = float(parent_state["mu_km3_s2"])
    elements = osculating_elements_from_state(relative_position, relative_velocity, central_mu)
    if elements is None:
        return None

    return {
        "epoch_utc": isoformat_utc(timestamp),
        "central_body_key": parent_key,
        "central_body_name": parent_state["name"],
        "central_mu_km3_s2": central_mu,
        **elements,
    }


def body_payloads(timestamp: datetime, catalog_objects: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, float]]:
    timescale, ephemeris = skyfield_context()
    time = timescale.from_datetime(timestamp)
    sun = ephemeris["sun"]
    earth = ephemeris["earth"]

    bodies: list[dict[str, Any]] = []
    state_cache: dict[tuple[str, str], dict[str, Any]] = {}
    earth_position = vector_payload((earth - sun).at(time))
    positions_by_key: dict[str, dict[str, float]] = {
        "sun": {
            "x_au": 0.0,
            "y_au": 0.0,
            "z_au": 0.0,
            "x_km": 0.0,
            "y_km": 0.0,
            "z_km": 0.0,
            "heliocentric_distance_km": 0.0,
        },
        "earth": earth_position,
    }

    for item in catalog_objects:
        if item["key"] == "sun":
            position = {
                "x_au": 0.0,
                "y_au": 0.0,
                "z_au": 0.0,
                "x_km": 0.0,
                "y_km": 0.0,
                "z_km": 0.0,
                "heliocentric_distance_km": 0.0,
            }
            earth_distance_km = float((sun - earth).at(time).distance().km)
        elif item.get("source_type") in STATIC_CATALOG_SOURCE_TYPES:
            position = radec_distance_position_payload(item)
            earth_distance_km = math.sqrt(
                (position["x_km"] - earth_position["x_km"]) ** 2
                + (position["y_km"] - earth_position["y_km"]) ** 2
                + (position["z_km"] - earth_position["z_km"]) ** 2
            )
        elif item.get("source_type") == "horizons":
            parent_key = item.get("parent_key")
            parent_position = positions_by_key.get(parent_key or "")
            if parent_position is None:
                raise RuntimeError(f"Horizons object {item['name']} requires loaded parent {parent_key}")
            relative_position = horizons_vector_payload(item, timestamp)
            position = add_relative_position(parent_position, relative_position)
            earth_distance_km = math.sqrt(
                (position["x_km"] - earth_position["x_km"]) ** 2
                + (position["y_km"] - earth_position["y_km"]) ** 2
                + (position["z_km"] - earth_position["z_km"]) ** 2
            )
        else:
            target = target_for_body(item, ephemeris)
            helio_vector = (target - sun).at(time)
            position = vector_payload(helio_vector)
            earth_distance_km = 0.0 if item["key"] == "earth" else float((target - earth).at(time).distance().km)

        positions_by_key[item["key"]] = position
        state_vector = None if item.get("source_type") in STATIC_CATALOG_SOURCE_TYPES else body_state_vector_payload(item, timestamp, state_cache)

        bodies.append(
            {
                "key": item["key"],
                "name": item["name"],
                "radius_km": item["radius_km"],
                "color": item["color"],
                "object_type": item["object_type"],
                "parent_key": item.get("parent_key"),
                "catalog_group": item["catalog_group"],
                "catalog": catalog_object_payload(item),
                "position": position,
                "state_vector": state_vector,
                "orbit": orbit_payload_for_item(item, timestamp, state_cache),
                "stellar": stellar_catalog_payload(item) if item.get("source_type") in {"stellar_catalog", "exoplanet_archive_system", "bright_star_catalog"} else None,
                "exoplanet_system": exoplanet_system_payload(item) if item.get("source_type") == "exoplanet_archive_system" else None,
                "deep_sky": deep_sky_catalog_payload(item) if item.get("source_type") == "deep_sky_catalog" else None,
                "distance_from_earth_km": earth_distance_km,
            }
        )

    return bodies, earth_position


def ephemeris_payload(timestamp: datetime, groups: list[str] | None = None, keys: list[str] | None = None) -> dict[str, Any]:
    selected_groups = list(STARTUP_CATALOG_GROUPS) if groups is None else groups
    selected_keys = keys or []
    catalog_objects = catalog_objects_for_selection(selected_groups, selected_keys)
    bodies, earth_position = body_payloads(timestamp, catalog_objects)

    return {
        "timestamp_utc": isoformat_utc(timestamp),
        "generated_at_utc": isoformat_utc(datetime.now(timezone.utc)),
        "data_source": EPHEMERIS_SOURCE,
        "coordinate_frame": "Heliocentric ecliptic Cartesian coordinates, projected top-down as x/y; z retained for distance calculations",
        "units": {
            "distance": "kilometers",
            "position": "astronomical units and kilometers",
            "velocity": "kilometers per second",
            "angle": "degrees",
            "time": "UTC ISO-8601 and days",
        },
        "au_km": AU_KM,
        "catalog": catalog_summary_payload(selected_groups, catalog_objects, include_objects=False),
        "hydrated_keys": selected_keys,
        "earth_position": earth_position,
        "bodies": bodies,
    }


def orbits_payload(timestamp: datetime, groups: list[str] | None = None) -> dict[str, Any]:
    selected_groups = groups or list(DEFAULT_CATALOG_GROUPS)
    catalog_objects = catalog_objects_for_groups(selected_groups)
    state_cache: dict[tuple[str, str], dict[str, Any]] = {}
    bodies: list[dict[str, Any]] = []

    for item in catalog_objects:
        state_vector = None if item.get("source_type") in STATIC_CATALOG_SOURCE_TYPES else body_state_vector_payload(item, timestamp, state_cache)
        bodies.append(
            {
                "key": item["key"],
                "name": item["name"],
                "object_type": item["object_type"],
                "parent_key": item.get("parent_key"),
                "catalog_group": item["catalog_group"],
                "catalog": catalog_object_payload(item),
                "state_vector": state_vector,
                "orbit": orbit_payload_for_item(item, timestamp, state_cache),
                "stellar": stellar_catalog_payload(item) if item.get("source_type") in {"stellar_catalog", "exoplanet_archive_system", "bright_star_catalog"} else None,
                "exoplanet_system": exoplanet_system_payload(item) if item.get("source_type") == "exoplanet_archive_system" else None,
                "deep_sky": deep_sky_catalog_payload(item) if item.get("source_type") == "deep_sky_catalog" else None,
            }
        )

    return {
        "timestamp_utc": isoformat_utc(timestamp),
        "generated_at_utc": isoformat_utc(datetime.now(timezone.utc)),
        "data_source": EPHEMERIS_SOURCE,
        "coordinate_frame": "Parent-relative ecliptic Cartesian state vectors with derived osculating orbital elements",
        "units": {
            "distance": "kilometers",
            "velocity": "kilometers per second",
            "angle": "degrees",
            "time": "UTC ISO-8601 and days",
        },
        "catalog": catalog_summary_payload(selected_groups, catalog_objects, include_objects=False),
        "bodies": bodies,
        "limitations": [
            "Elements are osculating values derived from one epoch state vector; they are not permanent catalog orbits.",
            "Planet entries that use barycenter ephemeris targets describe the barycenter orbit around the Sun.",
            "The top-down map still projects x/y only; inclination and z motion are represented numerically.",
        ],
    }


def trails_payload(
    timestamp: datetime,
    body_keys: list[str],
    days: float,
    step_days: float,
    request_meta: dict[str, Any],
) -> dict[str, Any]:
    timescale, ephemeris = skyfield_context()
    samples = trail_sample_datetimes(timestamp, days, step_days)
    sample_datetimes = [sample_timestamp for sample_timestamp, _offset_days in samples]
    time = timescale.from_datetimes(sample_datetimes)
    sun = ephemeris["sun"]

    bodies: list[dict[str, Any]] = []
    for key in body_keys:
        item = BODY_BY_KEY[key]
        if key == "sun":
            points = [
                zero_trail_point(sample_timestamp, offset_days)
                for sample_timestamp, offset_days in samples
            ]
        else:
            target = target_for_body(item, ephemeris)
            points = trail_points_from_vector((target - sun).at(time), samples)

        bodies.append(
            {
                "key": item["key"],
                "name": item["name"],
                "radius_km": item["radius_km"],
                "color": item["color"],
                "ephemeris": item["ephemeris"],
                "point_count": len(points),
                "points": points,
            }
        )

    return {
        "timestamp_utc": isoformat_utc(timestamp),
        "generated_at_utc": isoformat_utc(datetime.now(timezone.utc)),
        "data_source": EPHEMERIS_SOURCE,
        "coordinate_frame": "Heliocentric ecliptic Cartesian coordinates, projected top-down as x/y; z retained for distance calculations",
        "units": {
            "distance": "kilometers",
            "position": "astronomical units and kilometers",
            "time": "UTC ISO-8601",
        },
        "au_km": AU_KM,
        "parameters": {
            "bodies": body_keys,
            "days": days,
            "step_days": step_days,
            "requested_days": request_meta["requested_days"],
            "requested_step_days": request_meta["requested_step_days"],
            "clamped": request_meta["clamped"],
            "sample_count_per_body": len(samples),
            "start_offset_days": float(samples[0][1]),
            "end_offset_days": float(samples[-1][1]),
            "sample_start_utc": isoformat_utc(samples[0][0]),
            "sample_end_utc": isoformat_utc(samples[-1][0]),
        },
        "bodies": bodies,
    }


class Handler(BaseHTTPRequestHandler):
    def request_id(self) -> str:
        value = self.headers.get("X-Request-ID", "unknown")
        cleaned = re.sub(r"[^A-Za-z0-9_.-]", "", value)[:128]
        return cleaned or "unknown"

    def log_internal_error(self, operation: str) -> None:
        logging.exception("%s failed request_id=%s", operation, self.request_id())

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.respond({"ok": True})
            return

        if parsed.path == "/api/observe":
            try:
                query=parse_qs(parsed.query,keep_blank_values=True); key=query.get("key",[""])[0]; latitude=float(query.get("lat",[""])[0]); longitude=float(query.get("lon",[""])[0]); timestamp_value=query.get("timestamp",[None])[0]
                if timestamp_value and os.environ.get("ATLAS_ALLOW_TEST_TIME") != "1": raise QueryInputError("fixed timestamp is available only in test mode")
                self.respond(observe_payload(key,latitude,longitude,parse_timestamp(timestamp_value)))
            except (QueryInputError,ValueError) as exc: self.respond({"error":str(exc)},status=HTTPStatus.BAD_REQUEST)
            except Exception:
                self.log_internal_error("observation calculation")
                self.respond({"error":"observation calculation failed","request_id":self.request_id()},status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/ephemeris":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                timestamp = parse_timestamp(query.get("timestamp", [None])[0])
                groups = parse_catalog_groups(query, STARTUP_CATALOG_GROUPS)
                keys = parse_catalog_keys(query)
                key = cache_key_payload("ephemeris", timestamp_utc=isoformat_utc(timestamp), groups=groups, keys=keys)
                self.respond(cached_payload("api", key, lambda: ephemeris_payload(timestamp, groups, keys)))
            except QueryInputError as exc:
                payload: dict[str, Any] = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception:
                self.log_internal_error("ephemeris calculation")
                self.respond({"error": "ephemeris calculation failed", "request_id": self.request_id()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/catalog/search":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                timestamp = parse_timestamp(query.get("timestamp", [None])[0])
                groups = parse_catalog_groups(query)
                object_types = parse_catalog_object_types(query)
                query_text = query.get("q", [""])[0]
                offset = parse_int_param(query, "offset", 0, 0, 10_000_000)
                limit = parse_int_param(query, "limit", CATALOG_SEARCH_DEFAULT_LIMIT, 1, CATALOG_SEARCH_MAX_LIMIT)
                key = cache_key_payload(
                    "catalog_search",
                    timestamp_utc=isoformat_utc(timestamp),
                    groups=groups,
                    types=object_types,
                    query=query_text,
                    offset=offset,
                    limit=limit,
                )
                self.respond(cached_payload("api", key, lambda: catalog_search_payload(timestamp, groups, object_types, query_text, offset, limit)))
            except QueryInputError as exc:
                payload = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception:
                self.log_internal_error("catalog search")
                self.respond({"error": "catalog search failed", "request_id": self.request_id()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/catalog":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                groups = parse_catalog_groups(query)
                objects = catalog_objects_for_groups(groups)
                include_objects = parse_bool_param(query, "include_objects", True)
                key = cache_key_payload("catalog", groups=groups, include_objects=include_objects)
                self.respond(cached_payload("api", key, lambda: catalog_summary_payload(groups, objects, include_objects=include_objects)))
            except QueryInputError as exc:
                payload = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception:
                self.log_internal_error("catalog response")
                self.respond({"error": "catalog response failed", "request_id": self.request_id()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/orbits":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                timestamp = parse_timestamp(query.get("timestamp", [None])[0])
                groups = parse_catalog_groups(query)
                key = cache_key_payload("orbits", timestamp_utc=isoformat_utc(timestamp), groups=groups)
                self.respond(cached_payload("api", key, lambda: orbits_payload(timestamp, groups)))
            except QueryInputError as exc:
                payload: dict[str, Any] = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception:
                self.log_internal_error("orbit calculation")
                self.respond({"error": "orbit calculation failed", "request_id": self.request_id()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/trails":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                timestamp, body_keys, days, step_days, request_meta = parse_trails_query(query)
                key = cache_key_payload(
                    "trails",
                    timestamp_utc=isoformat_utc(timestamp),
                    bodies=body_keys,
                    days=days,
                    step_days=step_days,
                    requested_days=request_meta["requested_days"],
                    requested_step_days=request_meta["requested_step_days"],
                )
                self.respond(cached_payload("api", key, lambda: trails_payload(timestamp, body_keys, days, step_days, request_meta)))
            except QueryInputError as exc:
                payload: dict[str, Any] = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception:
                self.log_internal_error("trail calculation")
                self.respond({"error": "trail calculation failed", "request_id": self.request_id()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        self.respond({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def respond(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> bool:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # A proxy/browser can leave while a cold scientific build is in
            # progress. The completed single-flight build remains cached for
            # the next request; never attempt a second response on this socket.
            return False


def main() -> None:
    print(f"Cosmic Atlas ephemeris API listening on http://{HOST}:{PORT}")
    print(f"Skyfield data cache: {DATA_DIR}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
