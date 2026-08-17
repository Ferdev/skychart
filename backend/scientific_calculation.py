from __future__ import annotations

import json
import math
import re
import threading
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen, urlretrieve

from skyfield.api import Loader, Star, load_file, wgs84
from skyfield.framelib import ecliptic_frame

from backend.catalog_sources import (
    BODIES,
    BODY_BY_KEY,
    CATALOG_GROUPS,
    DEFAULT_CATALOG_GROUPS,
    HORIZONS_PARENT_CENTERS,
    STARTUP_CATALOG_GROUPS,
    STATIC_CATALOG_SOURCE_TYPES,
    catalog_object_payload,
    catalog_objects_for_groups,
    catalog_objects_for_selection,
    catalog_summary_payload,
    filtered_catalog_objects,
)
from backend.errors import QueryInputError
from backend.payload_cache import cache_key_payload, read_cache, write_cache
from backend.request_query import clamp_float, trail_sample_datetimes
from backend.settings import (
    AU_KM,
    DATA_DIR,
    EPHEMERIS_SOURCE,
    LIGHT_YEAR_KM,
    PARSEC_AU,
    SATELLITE_KERNEL_URLS,
    SECONDS_PER_DAY,
)
_loader: Loader | None = None
_timescale: Any | None = None
_ephemeris: Any | None = None
_satellite_kernels: dict[str, Any] = {}
_horizons_vectors: dict[tuple[str, str], dict[str, float]] = {}
_kernel_lock = threading.Lock()

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
    # The atlas renders in Skyfield's true ecliptic/equinox of date. Horizons'
    # ECLIPTIC output is fixed to J2000, so request ICRF vectors and rotate them
    # into the atlas frame below.
    coordinate_frame = "true_ecliptic_of_date_ut_v1"
    cache_key = (f"{horizons_id}@{center}:{coordinate_frame}", timestamp_key)
    cached = _horizons_vectors.get(cache_key)
    if cached is not None:
        return cached

    disk_cache_key = cache_key_payload(
        "horizons_vector",
        horizons_id=str(horizons_id),
        center=center,
        timestamp_utc=timestamp_key,
        coordinate_frame=coordinate_frame,
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
            "REF_PLANE": "FRAME",
            "REF_SYSTEM": "ICRF",
            "TIME_TYPE": "UT",
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
    icrf_position, icrf_velocity = parse_horizons_state_vector(result, item["name"])
    timescale, _ephemeris = skyfield_context()
    time = timescale.from_datetime(timestamp)
    rotation = ecliptic_frame.rotation_at(time)
    x_km, y_km, z_km = (float(value) for value in rotation.dot(icrf_position))
    vx_km_s, vy_km_s, vz_km_s = (float(value) for value in rotation.dot(icrf_velocity))
    position = {
        "x_au": x_km / AU_KM,
        "y_au": y_km / AU_KM,
        "z_au": z_km / AU_KM,
        "x_km": x_km,
        "y_km": y_km,
        "z_km": z_km,
        "vx_km_s": vx_km_s,
        "vy_km_s": vy_km_s,
        "vz_km_s": vz_km_s,
        "heliocentric_distance_km": math.sqrt(x_km * x_km + y_km * y_km + z_km * z_km),
    }
    _horizons_vectors[cache_key] = position
    write_cache("horizons", disk_cache_key, position)
    return position


def parse_horizons_state_vector(result: str, object_name: str) -> tuple[list[float], list[float]]:
    """Read only the generated vector table, never osculating data in its header."""
    try:
        vector_table = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    except IndexError as exc:
        raise RuntimeError(f"Horizons API did not return vector coordinates for {object_name}") from exc

    number = r"([+-]?(?:\d+(?:\.\d*)?|\.\d+)[Ee][+-]?\d+)"

    def component(label: str) -> float:
        match = re.search(rf"(?:^|\s){label}\s*=\s*{number}", vector_table)
        if match is None:
            raise RuntimeError(f"Horizons API did not return vector coordinates for {object_name}")
        return float(match.group(1))

    return (
        [component("X"), component("Y"), component("Z")],
        [component("VX"), component("VY"), component("VZ")],
    )


def small_body_horizons_command(designation: str) -> str:
    cleaned = designation.strip()
    return f"{cleaned};" if cleaned.isdigit() else f"DES={cleaned};"


def small_body_ephemeris_payload(designation: str, timestamp: datetime) -> dict[str, Any]:
    position = horizons_vector_payload(
        {
            "key": f"small-body:{designation}",
            "name": designation,
            "horizons_id": small_body_horizons_command(designation),
            "parent_key": "sun",
        },
        timestamp,
    )
    timescale, ephemeris = skyfield_context()
    time = timescale.from_datetime(timestamp)
    earth_position = vector_payload((ephemeris["earth"] - ephemeris["sun"]).at(time))
    distance_from_earth_km = math.sqrt(
        (position["x_km"] - earth_position["x_km"]) ** 2
        + (position["y_km"] - earth_position["y_km"]) ** 2
        + (position["z_km"] - earth_position["z_km"]) ** 2
    )
    return {
        "designation": designation,
        "timestamp_utc": isoformat_utc(timestamp),
        "position": position,
        "distance_from_earth_km": distance_from_earth_km,
        "position_model": "jpl_horizons_vectors",
        "source": "NASA/JPL Horizons",
    }


def small_body_ephemeris_unavailable(designation: str, timestamp: datetime, cause: Exception) -> dict[str, Any]:
    """Explicit missing-position payload for Horizons outages.

    The atlas falls back to two-body propagation when position is null, so an
    upstream failure keeps provenance semantics instead of becoming a 500.
    """
    return {
        "designation": designation,
        "timestamp_utc": isoformat_utc(timestamp),
        "position": None,
        "distance_from_earth_km": None,
        "position_model": "horizons_unavailable",
        "error": str(cause),
        "source": "NASA/JPL Horizons",
    }


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
