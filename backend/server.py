from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import urlopen, urlretrieve

from skyfield.api import Loader, load_file
from skyfield.framelib import ecliptic_frame


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "skyfield"
DEEP_SKY_CATALOG_PATH = ROOT / "data" / "catalogs" / "deep_sky_catalog.json"
HOST = "127.0.0.1"
PORT = 8765
AU_KM = 149_597_870.700
PARSEC_AU = 206_264.80624709636
LIGHT_YEAR_KM = 9_460_730_472_580.8
SUN_MU_KM3_S2 = 132_712_440_018.0
SECONDS_PER_DAY = 86_400.0
EPHEMERIS_SOURCE = (
    "NASA/JPL DE440s ephemeris via Skyfield; NAIF MAR099s satellite SPK; NASA/JPL Horizons vectors; "
    "NASA Exoplanet Archive host-star catalog; generated Messier deep-sky catalog snapshot"
)
TRAJECTORY_SOURCE = f"{EPHEMERIS_SOURCE}; patched-conic launch-window and single-flyby estimator"
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
    "messier_deep_sky": {
        "label": "Messier deep-sky catalog",
        "description": "Distance-known Messier objects with NGC/IC aliases, RA/Dec, magnitudes, angular sizes, and viewing metadata.",
    },
}
DEFAULT_CATALOG_GROUPS = tuple(CATALOG_GROUPS.keys())
STATIC_CATALOG_SOURCE_TYPES = {"stellar_catalog", "deep_sky_catalog"}
HORIZONS_PARENT_CENTERS = {
    "jupiter": "@5",
    "saturn": "@6",
}


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
    exoplanet_count: int | None = None,
    stellar_radius_solar: float | None = None,
    stellar_teff_k: float | None = None,
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
        "exoplanet_count": exoplanet_count,
        "stellar_radius_solar": stellar_radius_solar,
        "stellar_teff_k": stellar_teff_k,
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


def load_deep_sky_catalog_objects() -> list[dict[str, Any]]:
    if not DEEP_SKY_CATALOG_PATH.exists():
        return []

    payload = json.loads(DEEP_SKY_CATALOG_PATH.read_text(encoding="utf-8"))
    objects: list[dict[str, Any]] = []
    for entry in payload.get("objects", []):
        objects.append(
            catalog_object(
                key=str(entry["key"]),
                name=str(entry["name"]),
                ephemeris=f"Messier {entry['messier']}",
                radius_km=0.0,
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
            )
        )
    return objects


DEEP_SKY_CATALOG_OBJECTS = load_deep_sky_catalog_objects()
BODIES = [*CATALOG_OBJECTS, *DEEP_SKY_CATALOG_OBJECTS]
BODY_BY_KEY = {item["key"]: item for item in BODIES}
MOON_BODY_KEYS = {item["key"] for item in BODIES if item["object_type"] == "moon"}
DEFAULT_TRAIL_BODIES = ("earth", "mars", "jupiter")
DEFAULT_TRAIL_DAYS = 365.0
DEFAULT_TRAIL_STEP_DAYS = 14.0
MIN_TRAIL_DAYS = 1.0
MAX_TRAIL_DAYS = 3650.0
MIN_TRAIL_STEP_DAYS = 1.0
MAX_TRAIL_STEP_DAYS = 365.0
DEFAULT_TRAJECTORY_SCAN_DAYS = 900.0
DEFAULT_TRAJECTORY_STEP_DAYS = 60.0
MIN_TRAJECTORY_SCAN_DAYS = 0.0
MAX_TRAJECTORY_SCAN_DAYS = 3650.0
MIN_TRAJECTORY_STEP_DAYS = 15.0
MAX_TRAJECTORY_STEP_DAYS = 240.0
TRAJECTORY_SAMPLE_COUNT = 72

_loader: Loader | None = None
_timescale: Any | None = None
_ephemeris: Any | None = None
_satellite_kernels: dict[str, Any] = {}
_horizons_vectors: dict[tuple[str, str], dict[str, float]] = {}


class QueryInputError(ValueError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details


def skyfield_context() -> tuple[Any, Any]:
    global _loader, _timescale, _ephemeris
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


def parse_timestamp(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    cleaned = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(cleaned)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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


def stellar_catalog_payload(item: dict[str, Any]) -> dict[str, float | int | None]:
    distance_pc = item.get("distance_pc")
    return {
        "ra_deg": item.get("ra_deg"),
        "dec_deg": item.get("dec_deg"),
        "distance_pc": distance_pc,
        "distance_ly": float(distance_pc) * PARSEC_AU * AU_KM / LIGHT_YEAR_KM if distance_pc is not None else None,
        "exoplanet_count": item.get("exoplanet_count"),
        "stellar_radius_solar": item.get("stellar_radius_solar"),
        "stellar_teff_k": item.get("stellar_teff_k"),
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


def parse_catalog_groups(query: dict[str, list[str]]) -> list[str]:
    raw_values = query.get("groups")
    if raw_values is None:
        return list(DEFAULT_CATALOG_GROUPS)

    groups = [
        part.strip().lower()
        for value in raw_values
        for part in value.split(",")
        if part.strip()
    ]
    if not groups:
        return list(DEFAULT_CATALOG_GROUPS)

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


def catalog_objects_for_groups(groups: list[str]) -> list[dict[str, Any]]:
    group_set = set(groups)
    return [item for item in BODIES if item["catalog_group"] in group_set]


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
        "exoplanet_count": item.get("exoplanet_count"),
        "stellar_radius_solar": item.get("stellar_radius_solar"),
        "stellar_teff_k": item.get("stellar_teff_k"),
        "messier": item.get("messier"),
        "ngc": item.get("ngc"),
        "ic": item.get("ic"),
        "deep_sky_type": item.get("deep_sky_type"),
        "deep_sky_type_label": item.get("deep_sky_type_label"),
        "apparent_magnitude": item.get("apparent_magnitude"),
        "angular_size_arcmin": item.get("angular_size_arcmin"),
        "constellation": item.get("constellation"),
        "viewing_season": item.get("viewing_season"),
        "common_name": item.get("common_name"),
        "observing_equipment": item.get("observing_equipment"),
        "why_interesting": item.get("why_interesting"),
    }


def catalog_summary_payload(groups: list[str], objects: list[dict[str, Any]]) -> dict[str, Any]:
    kernels = sorted({
        item.get("kernel")
        or (
            "JPL Horizons vectors"
            if item.get("source_type") == "horizons"
            else "Messier deep-sky snapshot"
            if item.get("source_type") == "deep_sky_catalog"
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
        "kernels": kernels,
        "objects": [catalog_object_payload(item) for item in objects],
        "notes": [
            "Catalog records are separate from rendered ephemeris state so future object classes can be lazy-loaded.",
            "Loaded Solar System records use dynamic SPK or Horizons vector positions.",
        ],
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


def parse_body_key_param(query: dict[str, list[str]], *names: str, default: str) -> str:
    value = None
    for name in names:
        value = query.get(name, [None])[0]
        if value:
            break

    key = (value or default).strip().lower()
    if key not in BODY_BY_KEY:
        raise QueryInputError(
            "Unknown body key",
            details={
                "invalid_body": key,
                "valid_bodies": [item["key"] for item in BODIES],
            },
        )
    return key


def parse_trajectory_query(query: dict[str, list[str]]) -> tuple[datetime, str, str, float, float, dict[str, Any]]:
    try:
        timestamp = parse_timestamp(query.get("timestamp", [None])[0])
    except ValueError as exc:
        raise QueryInputError("timestamp must be an ISO-8601 datetime") from exc

    destination_key = parse_body_key_param(query, "destination", "target", default="jupiter")
    if destination_key in {"sun", "earth"}:
        raise QueryInputError("destination must be a body other than Sun or Earth")

    assist = (query.get("assist", ["auto"])[0] or "auto").strip().lower()
    if assist not in {"auto", "direct"} and assist not in BODY_BY_KEY:
        raise QueryInputError(
            "Unknown assist body",
            details={
                "invalid_body": assist,
                "valid_assists": ["auto", "direct", *[item["key"] for item in BODIES]],
            },
        )
    if assist in {"sun", "earth", *MOON_BODY_KEYS, destination_key}:
        assist = "auto"

    requested_scan_days = parse_float_param(query, "scan_days", DEFAULT_TRAJECTORY_SCAN_DAYS)
    scan_days = clamp_float(requested_scan_days, MIN_TRAJECTORY_SCAN_DAYS, MAX_TRAJECTORY_SCAN_DAYS)

    requested_step_days = parse_float_param(query, "step_days", DEFAULT_TRAJECTORY_STEP_DAYS)
    step_days = clamp_float(requested_step_days, MIN_TRAJECTORY_STEP_DAYS, MAX_TRAJECTORY_STEP_DAYS)
    if scan_days == 0:
        step_days = MIN_TRAJECTORY_STEP_DAYS

    return (
        timestamp,
        destination_key,
        assist,
        scan_days,
        step_days,
        {
            "requested_scan_days": requested_scan_days,
            "requested_step_days": requested_step_days,
            "clamped": requested_scan_days != scan_days or requested_step_days != step_days,
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


def vector3_add(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


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


def vector3_unit(value: tuple[float, float, float]) -> tuple[float, float, float]:
    norm = vector3_norm(value)
    if norm == 0:
        return (0.0, 0.0, 0.0)
    return (value[0] / norm, value[1] / norm, value[2] / norm)


def vector3_angle_deg(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    a_norm = vector3_norm(a)
    b_norm = vector3_norm(b)
    if a_norm == 0 or b_norm == 0:
        return 0.0
    cosine = clamp_float(vector3_dot(a, b) / (a_norm * b_norm), -1.0, 1.0)
    return math.degrees(math.acos(cosine))


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


def state_event(kind: str, state: dict[str, Any], offset_days: float) -> dict[str, Any]:
    x_au, y_au, z_au = state["position_au"]
    return {
        "kind": kind,
        "body_key": state["key"],
        "body_name": state["name"],
        "timestamp_utc": state["timestamp_utc"],
        "offset_days": float(offset_days),
        "x_au": x_au,
        "y_au": y_au,
        "z_au": z_au,
    }


def hohmann_time_days(radius_a_km: float, radius_b_km: float) -> float:
    if radius_a_km <= 0 or radius_b_km <= 0:
        return 30.0
    semi_major_km = (radius_a_km + radius_b_km) / 2.0
    seconds = math.pi * math.sqrt((semi_major_km**3) / SUN_MU_KM3_S2)
    return seconds / SECONDS_PER_DAY


def duration_candidates_days(radius_a_km: float, radius_b_km: float, *, minimum_days: float = 5.0) -> list[float]:
    base = max(minimum_days, hohmann_time_days(radius_a_km, radius_b_km))
    candidates = [base * 0.7, base, base * 1.35]
    unique: list[float] = []
    for value in candidates:
        clamped = clamp_float(value, minimum_days, 4200.0)
        if all(not math.isclose(clamped, existing, rel_tol=0.0, abs_tol=0.5) for existing in unique):
            unique.append(clamped)
    return unique


def transfer_leg_metrics(start: dict[str, Any], end: dict[str, Any], tof_days: float) -> dict[str, Any] | None:
    if tof_days <= 0:
        return None
    tof_seconds = tof_days * SECONDS_PER_DAY
    displacement_km = vector3_sub(end["position_km"], start["position_km"])
    chord_km = vector3_norm(displacement_km)
    transfer_velocity = vector3_scale(displacement_km, 1.0 / tof_seconds)
    departure_vinf = vector3_sub(transfer_velocity, start["velocity_km_s"])
    arrival_vinf = vector3_sub(transfer_velocity, end["velocity_km_s"])
    path_distance_km = chord_km * 1.16

    return {
        "from": start["key"],
        "from_name": start["name"],
        "to": end["key"],
        "to_name": end["name"],
        "tof_days": float(tof_days),
        "path_distance_km": float(path_distance_km),
        "transfer_velocity_km_s": transfer_velocity,
        "departure_vinf_vector_km_s": departure_vinf,
        "arrival_vinf_vector_km_s": arrival_vinf,
        "departure_vinf_km_s": float(vector3_norm(departure_vinf)),
        "arrival_vinf_km_s": float(vector3_norm(arrival_vinf)),
    }


def flyby_metrics(incoming_leg: dict[str, Any], outgoing_leg: dict[str, Any], assist_state: dict[str, Any]) -> dict[str, Any]:
    incoming = incoming_leg["arrival_vinf_vector_km_s"]
    outgoing = outgoing_leg["departure_vinf_vector_km_s"]
    incoming_speed = vector3_norm(incoming)
    outgoing_speed = vector3_norm(outgoing)
    mean_speed = max(0.001, (incoming_speed + outgoing_speed) / 2.0)
    turn_angle_deg = vector3_angle_deg(incoming, outgoing)
    periapsis_km = assist_state["radius_km"] + max(300.0, assist_state["radius_km"] * 0.12)
    max_turn_rad = 2.0 * math.asin(clamp_float(1.0 / (1.0 + (periapsis_km * mean_speed**2) / assist_state["mu_km3_s2"]), 0.0, 1.0))
    max_turn_deg = math.degrees(max_turn_rad)
    turn_deficit_deg = max(0.0, turn_angle_deg - max_turn_deg)
    powered_flyby_delta_v_km_s = 2.0 * mean_speed * math.sin(math.radians(turn_deficit_deg) / 2.0) if turn_deficit_deg > 0 else 0.0
    speed_change_km_s = outgoing_speed - incoming_speed

    return {
        "body_key": assist_state["key"],
        "body_name": assist_state["name"],
        "incoming_vinf_km_s": float(incoming_speed),
        "outgoing_vinf_km_s": float(outgoing_speed),
        "speed_change_km_s": float(speed_change_km_s),
        "turn_angle_deg": float(turn_angle_deg),
        "max_turn_angle_deg": float(max_turn_deg),
        "turn_deficit_deg": float(turn_deficit_deg),
        "periapsis_altitude_km": float(periapsis_km - assist_state["radius_km"]),
        "powered_flyby_delta_v_km_s": float(powered_flyby_delta_v_km_s),
        "feasible": turn_deficit_deg <= 0.5,
    }


def departure_offsets(scan_days: float, step_days: float) -> list[float]:
    offsets = [0.0]
    if scan_days <= 0:
        return offsets
    offset = step_days
    while offset <= scan_days + 1e-9:
        offsets.append(float(offset))
        offset += step_days
    return offsets


def candidate_assist_keys(destination_key: str, requested_assist: str) -> list[str]:
    if requested_assist == "direct":
        return []
    if BODY_BY_KEY[destination_key].get("source_type") in STATIC_CATALOG_SOURCE_TYPES:
        return []
    if requested_assist != "auto":
        return [requested_assist]

    target_radius = {
        "moon": 1.0,
        "mars": 1.52,
        "phobos": 1.52,
        "deimos": 1.52,
        "jupiter": 5.2,
        "saturn": 9.58,
        "uranus": 19.2,
        "neptune": 30.1,
        "pluto": 39.5,
    }.get(destination_key, 2.0)
    if target_radius > 6:
        candidates = ["jupiter", "mars", "venus"]
    elif target_radius > 2:
        candidates = ["venus", "mars"]
    elif destination_key == "mars":
        candidates = ["venus"]
    else:
        candidates = ["venus", "mars"]
    return [key for key in candidates if key not in {"earth", *MOON_BODY_KEYS, destination_key} and key in BODY_BY_KEY]


def route_point_from_au(position_au: tuple[float, float, float]) -> dict[str, float]:
    return {
        "x_au": float(position_au[0]),
        "y_au": float(position_au[1]),
        "z_au": float(position_au[2]),
    }


def prograde_tangent(point: tuple[float, float, float]) -> tuple[float, float, float]:
    radius = math.hypot(point[0], point[1])
    if radius == 0:
        return (0.0, 1.0, 0.0)
    return (-point[1] / radius, point[0] / radius, 0.0)


def cubic_point(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
    c: tuple[float, float, float],
    d: tuple[float, float, float],
    t: float,
) -> tuple[float, float, float]:
    inv = 1.0 - t
    inv2 = inv * inv
    t2 = t * t
    return (
        inv2 * inv * a[0] + 3.0 * inv2 * t * b[0] + 3.0 * inv * t2 * c[0] + t2 * t * d[0],
        inv2 * inv * a[1] + 3.0 * inv2 * t * b[1] + 3.0 * inv * t2 * c[1] + t2 * t * d[1],
        a[2] + (d[2] - a[2]) * t,
    )


def segment_samples(start_au: tuple[float, float, float], end_au: tuple[float, float, float], count: int) -> list[dict[str, float]]:
    chord = vector3_norm(vector3_sub(end_au, start_au))
    if chord == 0:
        return [route_point_from_au(start_au)]

    start_radius = math.hypot(start_au[0], start_au[1])
    end_radius = math.hypot(end_au[0], end_au[1])
    start_tangent = prograde_tangent(start_au)
    end_tangent = prograde_tangent(end_au)
    control_au = clamp_float(chord * 0.44 + abs(end_radius - start_radius) * 0.08, 0.001, max(chord, start_radius, end_radius) * 0.8)
    control_a = vector3_add(start_au, vector3_scale(start_tangent, control_au))
    control_b = vector3_sub(end_au, vector3_scale(end_tangent, control_au))

    return [
        route_point_from_au(cubic_point(start_au, control_a, control_b, end_au, index / count))
        for index in range(count + 1)
    ]


def candidate_samples(events: list[dict[str, Any]]) -> list[dict[str, float]]:
    samples: list[dict[str, float]] = []
    for index in range(1, len(events)):
        start = (events[index - 1]["x_au"], events[index - 1]["y_au"], events[index - 1]["z_au"])
        end = (events[index]["x_au"], events[index]["y_au"], events[index]["z_au"])
        segment = segment_samples(start, end, TRAJECTORY_SAMPLE_COUNT)
        if samples:
            segment = segment[1:]
        samples.extend(segment)
    return samples


def slim_leg_payload(leg: dict[str, Any]) -> dict[str, Any]:
    return {
        "from": leg["from"],
        "from_name": leg["from_name"],
        "to": leg["to"],
        "to_name": leg["to_name"],
        "tof_days": leg["tof_days"],
        "path_distance_km": leg["path_distance_km"],
        "departure_vinf_km_s": leg["departure_vinf_km_s"],
        "arrival_vinf_km_s": leg["arrival_vinf_km_s"],
    }


def build_direct_candidate(
    candidate_id: str,
    departure_state: dict[str, Any],
    arrival_state: dict[str, Any],
    departure_offset_days: float,
    tof_days: float,
) -> dict[str, Any] | None:
    leg = transfer_leg_metrics(departure_state, arrival_state, tof_days)
    if leg is None:
        return None
    events = [
        state_event("departure", departure_state, departure_offset_days),
        state_event("arrival", arrival_state, departure_offset_days + tof_days),
    ]
    total_delta_v = leg["departure_vinf_km_s"] + leg["arrival_vinf_km_s"]
    score = total_delta_v + tof_days / 1200.0
    return {
        "id": candidate_id,
        "kind": "direct",
        "label": "Direct transfer",
        "body_sequence": ["earth", arrival_state["key"]],
        "assist_body_key": None,
        "events": events,
        "legs": [slim_leg_payload(leg)],
        "samples": candidate_samples(events),
        "warnings": ["Direct transfer estimate uses patched-conic scoring, not n-body propagation."],
        "metrics": {
            "total_delta_v_km_s": float(total_delta_v),
            "launch_vinf_km_s": leg["departure_vinf_km_s"],
            "arrival_vinf_km_s": leg["arrival_vinf_km_s"],
            "total_time_days": float(tof_days),
            "departure_offset_days": float(departure_offset_days),
            "arrival_offset_days": float(departure_offset_days + tof_days),
            "path_distance_km": float(sum(item["path_distance_km"] for item in [leg])),
            "score": float(score),
            "feasible": True,
        },
    }


def build_assist_candidate(
    candidate_id: str,
    departure_state: dict[str, Any],
    flyby_state: dict[str, Any],
    arrival_state: dict[str, Any],
    departure_offset_days: float,
    first_leg_days: float,
    second_leg_days: float,
) -> dict[str, Any] | None:
    incoming_leg = transfer_leg_metrics(departure_state, flyby_state, first_leg_days)
    outgoing_leg = transfer_leg_metrics(flyby_state, arrival_state, second_leg_days)
    if incoming_leg is None or outgoing_leg is None:
        return None

    flyby = flyby_metrics(incoming_leg, outgoing_leg, flyby_state)
    events = [
        state_event("departure", departure_state, departure_offset_days),
        state_event("flyby", flyby_state, departure_offset_days + first_leg_days),
        state_event("arrival", arrival_state, departure_offset_days + first_leg_days + second_leg_days),
    ]
    total_time_days = first_leg_days + second_leg_days
    launch_vinf = incoming_leg["departure_vinf_km_s"]
    arrival_vinf = outgoing_leg["arrival_vinf_km_s"]
    powered_flyby = flyby["powered_flyby_delta_v_km_s"]
    total_delta_v = launch_vinf + arrival_vinf + powered_flyby
    assist_bonus = min(4.0, max(0.0, flyby["speed_change_km_s"]))
    score = total_delta_v + total_time_days / 1400.0 - assist_bonus
    warnings: list[str] = ["Single-flyby patched-conic estimate; not optimized with a full Lambert/n-body solver."]
    if not flyby["feasible"]:
        warnings.append("Flyby turn exceeds the unpowered estimate; this route would need correction burn or a safer window.")

    return {
        "id": candidate_id,
        "kind": "gravity_assist",
        "label": f"{flyby_state['name']} gravity assist",
        "body_sequence": ["earth", flyby_state["key"], arrival_state["key"]],
        "assist_body_key": flyby_state["key"],
        "events": events,
        "legs": [slim_leg_payload(incoming_leg), slim_leg_payload(outgoing_leg)],
        "samples": candidate_samples(events),
        "warnings": warnings,
        "flyby": flyby,
        "metrics": {
            "total_delta_v_km_s": float(total_delta_v),
            "launch_vinf_km_s": float(launch_vinf),
            "arrival_vinf_km_s": float(arrival_vinf),
            "powered_flyby_delta_v_km_s": float(powered_flyby),
            "total_time_days": float(total_time_days),
            "departure_offset_days": float(departure_offset_days),
            "flyby_offset_days": float(departure_offset_days + first_leg_days),
            "arrival_offset_days": float(departure_offset_days + total_time_days),
            "path_distance_km": float(incoming_leg["path_distance_km"] + outgoing_leg["path_distance_km"]),
            "assist_speed_change_km_s": flyby["speed_change_km_s"],
            "score": float(score),
            "feasible": bool(flyby["feasible"]),
        },
    }


def display_candidate_key(candidate: dict[str, Any]) -> tuple[str, str]:
    if candidate["kind"] == "gravity_assist":
        return (candidate["kind"], candidate["assist_body_key"] or candidate["label"])
    return (candidate["kind"], "direct")


def display_candidates(candidates: list[dict[str, Any]], *pinned: dict[str, Any] | None) -> list[dict[str, Any]]:
    display: list[dict[str, Any]] = []
    seen_routes: set[tuple[str, str]] = set()

    for candidate in [item for item in pinned if item is not None] + sorted(candidates, key=lambda item: item["metrics"]["score"]):
        route_key = display_candidate_key(candidate)
        if route_key in seen_routes:
            continue
        display.append(candidate)
        seen_routes.add(route_key)
        if len(display) >= 8:
            break

    return display


def trajectory_payload(
    timestamp: datetime,
    destination_key: str,
    assist: str,
    scan_days: float,
    step_days: float,
    request_meta: dict[str, Any],
) -> dict[str, Any]:
    if BODY_BY_KEY[destination_key].get("source_type") in STATIC_CATALOG_SOURCE_TYPES:
        raise QueryInputError("Trajectory planner is disabled for static catalog targets")

    state_cache: dict[tuple[str, str], dict[str, Any]] = {}
    current_earth = body_state("earth", timestamp, state_cache)
    current_target = body_state(destination_key, timestamp, state_cache)
    direct_duration_options = duration_candidates_days(
        vector3_norm(current_earth["position_km"]),
        vector3_norm(current_target["position_km"]),
        minimum_days=4.0 if destination_key in MOON_BODY_KEYS else 45.0,
    )

    candidates: list[dict[str, Any]] = []
    for departure_offset in departure_offsets(scan_days, step_days):
        departure_time = timestamp + timedelta(days=departure_offset)
        departure_state = body_state("earth", departure_time, state_cache)
        for tof_days in direct_duration_options:
            arrival_time = departure_time + timedelta(days=tof_days)
            arrival_state = body_state(destination_key, arrival_time, state_cache)
            candidate = build_direct_candidate(
                f"direct-{len(candidates) + 1}",
                departure_state,
                arrival_state,
                departure_offset,
                tof_days,
            )
            if candidate is not None:
                candidates.append(candidate)

    assist_keys = candidate_assist_keys(destination_key, assist)
    for assist_key in assist_keys:
        assist_current = body_state(assist_key, timestamp, state_cache)
        first_leg_options = duration_candidates_days(
            vector3_norm(current_earth["position_km"]),
            vector3_norm(assist_current["position_km"]),
            minimum_days=40.0,
        )
        second_leg_options = duration_candidates_days(
            vector3_norm(assist_current["position_km"]),
            vector3_norm(current_target["position_km"]),
            minimum_days=45.0,
        )
        for departure_offset in departure_offsets(scan_days, step_days * 1.5):
            departure_time = timestamp + timedelta(days=departure_offset)
            departure_state = body_state("earth", departure_time, state_cache)
            for first_leg_days in first_leg_options:
                flyby_time = departure_time + timedelta(days=first_leg_days)
                flyby_state = body_state(assist_key, flyby_time, state_cache)
                for second_leg_days in second_leg_options:
                    arrival_time = flyby_time + timedelta(days=second_leg_days)
                    arrival_state = body_state(destination_key, arrival_time, state_cache)
                    candidate = build_assist_candidate(
                        f"assist-{assist_key}-{len(candidates) + 1}",
                        departure_state,
                        flyby_state,
                        arrival_state,
                        departure_offset,
                        first_leg_days,
                        second_leg_days,
                    )
                    if candidate is not None:
                        candidates.append(candidate)

    if not candidates:
        raise QueryInputError("Could not produce trajectory candidates for this request")

    direct_candidates = [candidate for candidate in candidates if candidate["kind"] == "direct"]
    assist_candidates = [candidate for candidate in candidates if candidate["kind"] == "gravity_assist"]
    best_direct = min(direct_candidates, key=lambda item: item["metrics"]["score"]) if direct_candidates else None
    feasible_assists = [candidate for candidate in assist_candidates if candidate["metrics"]["feasible"]]
    best_assist_pool = feasible_assists or assist_candidates
    best_assist = min(best_assist_pool, key=lambda item: item["metrics"]["score"]) if best_assist_pool else None
    selected = best_assist or best_direct or min(candidates, key=lambda item: item["metrics"]["score"])

    unique_candidates = display_candidates(candidates, selected, best_direct, best_assist)

    return {
        "timestamp_utc": isoformat_utc(timestamp),
        "generated_at_utc": isoformat_utc(datetime.now(timezone.utc)),
        "data_source": TRAJECTORY_SOURCE,
        "coordinate_frame": "Heliocentric ecliptic Cartesian coordinates, projected top-down as x/y; z retained for scoring",
        "units": {
            "distance": "kilometers",
            "position": "astronomical units",
            "velocity": "kilometers per second",
            "time": "UTC ISO-8601 and days",
        },
        "parameters": {
            "origin": "earth",
            "destination": destination_key,
            "assist": assist,
            "scan_days": scan_days,
            "step_days": step_days,
            "requested_scan_days": request_meta["requested_scan_days"],
            "requested_step_days": request_meta["requested_step_days"],
            "clamped": request_meta["clamped"],
            "candidate_count": len(candidates),
        },
        "selected_candidate_id": selected["id"],
        "best_direct_candidate_id": best_direct["id"] if best_direct else None,
        "best_gravity_assist_candidate_id": best_assist["id"] if best_assist else None,
        "candidates": unique_candidates,
        "limitations": [
            "This is a patched-conic planning estimate, not a final mission trajectory.",
            "The search evaluates direct and single-flyby windows from real JPL ephemeris states.",
            "Flyby feasibility uses idealized turn-angle estimates and does not include n-body perturbations, finite burns, or launch vehicle constraints.",
        ],
    }


def ephemeris_payload(timestamp: datetime, groups: list[str] | None = None) -> dict[str, Any]:
    timescale, ephemeris = skyfield_context()
    time = timescale.from_datetime(timestamp)
    sun = ephemeris["sun"]
    earth = ephemeris["earth"]
    selected_groups = groups or list(DEFAULT_CATALOG_GROUPS)
    catalog_objects = catalog_objects_for_groups(selected_groups)

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
                "state_vector": body_state_vector_payload(item, timestamp, state_cache),
                "orbit": orbit_payload_for_item(item, timestamp, state_cache),
                "stellar": stellar_catalog_payload(item) if item.get("source_type") == "stellar_catalog" else None,
                "deep_sky": deep_sky_catalog_payload(item) if item.get("source_type") == "deep_sky_catalog" else None,
                "distance_from_earth_km": earth_distance_km,
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
            "velocity": "kilometers per second",
            "angle": "degrees",
            "time": "UTC ISO-8601 and days",
        },
        "au_km": AU_KM,
        "catalog": catalog_summary_payload(selected_groups, catalog_objects),
        "earth_position": earth_position,
        "bodies": bodies,
    }


def orbits_payload(timestamp: datetime, groups: list[str] | None = None) -> dict[str, Any]:
    selected_groups = groups or list(DEFAULT_CATALOG_GROUPS)
    catalog_objects = catalog_objects_for_groups(selected_groups)
    state_cache: dict[tuple[str, str], dict[str, Any]] = {}
    bodies: list[dict[str, Any]] = []

    for item in catalog_objects:
        bodies.append(
            {
                "key": item["key"],
                "name": item["name"],
                "object_type": item["object_type"],
                "parent_key": item.get("parent_key"),
                "catalog_group": item["catalog_group"],
                "catalog": catalog_object_payload(item),
                "state_vector": body_state_vector_payload(item, timestamp, state_cache),
                "orbit": orbit_payload_for_item(item, timestamp, state_cache),
                "stellar": stellar_catalog_payload(item) if item.get("source_type") == "stellar_catalog" else None,
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
        "catalog": catalog_summary_payload(selected_groups, catalog_objects),
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

        if parsed.path == "/api/ephemeris":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                timestamp = parse_timestamp(query.get("timestamp", [None])[0])
                groups = parse_catalog_groups(query)
                self.respond(ephemeris_payload(timestamp, groups))
            except QueryInputError as exc:
                payload: dict[str, Any] = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.respond({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/catalog":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                groups = parse_catalog_groups(query)
                objects = catalog_objects_for_groups(groups)
                self.respond(catalog_summary_payload(groups, objects))
            except QueryInputError as exc:
                payload = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.respond({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/orbits":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                timestamp = parse_timestamp(query.get("timestamp", [None])[0])
                groups = parse_catalog_groups(query)
                self.respond(orbits_payload(timestamp, groups))
            except QueryInputError as exc:
                payload: dict[str, Any] = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.respond({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/trails":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                self.respond(trails_payload(*parse_trails_query(query)))
            except QueryInputError as exc:
                payload: dict[str, Any] = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.respond({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/api/trajectory":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                self.respond(trajectory_payload(*parse_trajectory_query(query)))
            except QueryInputError as exc:
                payload: dict[str, Any] = {"error": str(exc)}
                if exc.details is not None:
                    payload["details"] = exc.details
                self.respond(payload, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.respond({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        self.respond({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def respond(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    print(f"Cosmic Atlas ephemeris API listening on http://{HOST}:{PORT}")
    print(f"Skyfield data cache: {DATA_DIR}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
