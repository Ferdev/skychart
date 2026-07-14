from __future__ import annotations

import json
import math
import re
from typing import Any

from backend.settings import (
    AU_KM,
    BRIGHT_STAR_CATALOG_PATH,
    DEEP_SKY_CATALOG_PATH,
    EXOPLANET_CATALOG_PATH,
    LIGHT_YEAR_KM,
    PARSEC_AU,
    SUN_MU_KM3_S2,
)

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

def horizons_center_for_item(item: dict[str, Any]) -> str:
    parent_key = item.get("parent_key")
    return HORIZONS_PARENT_CENTERS.get(parent_key, "@sun")

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
