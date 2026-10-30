"""Ranked targets for one night at one ground site.

The site comes from the request body and stays in memory for that request. It is
not written to the payload cache, to a log line, or to the response.
"""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

import numpy as np
from skyfield import almanac
from skyfield.api import wgs84
from skyfield.nutationlib import iau2000b_radians

from backend.errors import QueryInputError
from backend.scientific_calculation import isoformat_utc, skyfield_context
from backend.settings import DEEP_SKY_CATALOG_PATH, NGC_IC_CATALOG_PATH

# The deepest twilight first. The altitudes are the Sun center; "sunset" includes the
# standard 34 arcmin of refraction and the 16 arcmin of the solar radius.
TWILIGHTS = (("astronomical", -18.0), ("nautical", -12.0), ("civil", -6.0), ("sunset", -0.8333))
SUN_STEP_MINUTES = 2
TARGET_STEP_MINUTES = 5
DEFAULT_LIMIT = 100
MAX_LIMIT = 200
DEFAULT_MIN_ALTITUDE_DEG = 30.0
MAX_BODY_BYTES = 4_096
TARGET_TYPES = ("galaxy", "nebula", "star_cluster", "asterism")
# DE440s covers 1849-2150; the margin keeps a full night and the Moon inside the kernel.
MIN_DATE = date(1900, 1, 1)
MAX_DATE = date(2100, 12, 31)
ACCURACY_NOTE = (
    "Geometric positions at J2000 catalog coordinates, sampled every five minutes. "
    "Refraction, local obstructions, weather, and light pollution are not modeled."
)


def _angular_major_arcmin(row: dict[str, Any]) -> float | None:
    facts = row.get("facts") or {}
    if isinstance(facts.get("major_axis_arcmin"), (int, float)):
        return float(facts["major_axis_arcmin"])
    match = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", str(row.get("angular_size_arcmin") or ""))
    return float(match.group(1)) if match else None


def _candidate(row: dict[str, Any], catalog: str) -> dict[str, Any] | None:
    if row.get("object_type") not in TARGET_TYPES:
        return None
    if not isinstance(row.get("ra_deg"), (int, float)) or not isinstance(row.get("dec_deg"), (int, float)):
        return None
    return {
        "key": row["key"],
        "name": row["name"],
        "object_type": row["object_type"],
        "constellation": row.get("constellation"),
        "catalog": catalog,
        "ra_deg": float(row["ra_deg"]),
        "dec_deg": float(row["dec_deg"]),
        "magnitude": row.get("apparent_magnitude"),
        "size_arcmin": _angular_major_arcmin(row),
    }


@lru_cache(maxsize=1)
def target_catalog() -> tuple[dict[str, Any], ...]:
    """Messier first. An OpenNGC row with a Messier number is the same object, so it is left out."""
    messier = json.loads(DEEP_SKY_CATALOG_PATH.read_text(encoding="utf-8"))["objects"]
    open_ngc = json.loads(NGC_IC_CATALOG_PATH.read_text(encoding="utf-8"))["objects"]
    numbers = {row.get("messier") for row in messier}
    rows = [_candidate(row, "Messier") for row in messier]
    rows += [_candidate(row, "OpenNGC") for row in open_ngc if row.get("messier") not in numbers]
    return tuple(row for row in rows if row is not None)


def _number(body: dict[str, Any], name: str, default: float | None, minimum: float, maximum: float) -> float | None:
    value = body.get(name)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise QueryInputError(f"{name} must be between {minimum:g} and {maximum:g}")
    return float(value)


def _night_date(value: Any) -> date:
    try:
        night = date.fromisoformat(value) if isinstance(value, str) and len(value) == 10 else None
    except ValueError:
        night = None
    if night is None or not MIN_DATE <= night <= MAX_DATE:
        raise QueryInputError(f"date must be a day from {MIN_DATE} to {MAX_DATE}")
    return night


def _target_types(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(item not in TARGET_TYPES for item in value):
        raise QueryInputError(f"types must be a list of: {', '.join(TARGET_TYPES)}")
    return list(value)


def _times(timescale: Any, start: datetime, step_minutes: float, count: int) -> Any:
    times = timescale.utc(start.year, start.month, start.day, start.hour, start.minute, start.second + start.microsecond / 1e6 + 60.0 * step_minutes * np.arange(count))
    # The short nutation series is correct to about 1 mas and a hundred times faster. Skyfield's almanac does the same.
    times._nutation_angles_radians = iau2000b_radians(times)
    return times


def _crossing(start: datetime, step_minutes: float, index: int, first: float, second: float, level: float) -> datetime:
    return start + timedelta(minutes=step_minutes * (index + (level - first) / (second - first)))


def _dark_interval(start: datetime, altitudes: np.ndarray, level: float) -> tuple[datetime | None, datetime | None] | None:
    """The interval below `level` that holds the lowest Sun. A missing end means that the Sun does not cross `level` there."""
    lowest = int(np.argmin(altitudes))
    if altitudes[lowest] >= level:
        return None
    first = lowest
    while first > 0 and altitudes[first - 1] < level:
        first -= 1
    last = lowest
    while last < len(altitudes) - 1 and altitudes[last + 1] < level:
        last += 1
    dusk = None if first == 0 else _crossing(start, SUN_STEP_MINUTES, first - 1, altitudes[first - 1], altitudes[first], level)
    dawn = None if last == len(altitudes) - 1 else _crossing(start, SUN_STEP_MINUTES, last, altitudes[last], altitudes[last + 1], level)
    return dusk, dawn


def _windows(start: datetime, step_minutes: float, altitudes: np.ndarray, level: float) -> list[dict[str, str]]:
    above = altitudes >= level
    edges = np.flatnonzero(np.diff(above.astype(np.int8)))
    windows: list[dict[str, str]] = []
    opened: datetime | None = start if above[0] else None
    for index in edges.tolist():
        moment = _crossing(start, step_minutes, index, altitudes[index], altitudes[index + 1], level)
        if above[index + 1]:
            opened = moment
        elif opened is not None:
            windows.append({"start_utc": isoformat_utc(opened), "end_utc": isoformat_utc(moment)})
            opened = None
    if opened is not None:
        windows.append({"start_utc": isoformat_utc(opened), "end_utc": isoformat_utc(start + timedelta(minutes=step_minutes * (len(altitudes) - 1)))})
    return windows


def _minutes_above(margin: np.ndarray, step_minutes: float) -> np.ndarray:
    """Minutes above the level for each row of `altitude - level`, with a linear crossing inside a sample step."""
    first, second = margin[:, :-1], margin[:, 1:]
    crossing = (first >= 0) != (second >= 0)
    share = ((first >= 0) & (second >= 0)).astype(np.float64)
    share[crossing] = np.maximum(first, second)[crossing] / np.abs(first - second)[crossing]
    return share.sum(axis=1) * step_minutes


def _selected(body: dict[str, Any], latitude: float, min_altitude: float) -> list[dict[str, Any]]:
    types = set(_target_types(body.get("types")))
    max_magnitude = _number(body, "max_magnitude", None, -5, 30)
    min_size = _number(body, "min_size_arcmin", None, 0, 1000)
    max_size = _number(body, "max_size_arcmin", None, 0, 1000)
    rows = []
    for row in target_catalog():
        if types and row["object_type"] not in types:
            continue
        if max_magnitude is not None and (row["magnitude"] is None or row["magnitude"] > max_magnitude):
            continue
        if min_size is not None and (row["size_arcmin"] is None or row["size_arcmin"] < min_size):
            continue
        if max_size is not None and (row["size_arcmin"] is None or row["size_arcmin"] > max_size):
            continue
        # The highest altitude that a fixed declination can reach at this latitude.
        if 90 - abs(latitude - row["dec_deg"]) < min_altitude:
            continue
        rows.append(row)
    return rows


def night_plan_payload(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise QueryInputError("the request body must be a JSON object")
    latitude = _number(body, "latitude_deg", math.nan, -90, 90)
    longitude = _number(body, "longitude_deg", math.nan, -180, 180)
    if latitude is None or longitude is None or math.isnan(latitude) or math.isnan(longitude):
        raise QueryInputError("latitude_deg and longitude_deg are required")
    night = _night_date(body.get("date"))
    min_altitude = _number(body, "min_altitude_deg", DEFAULT_MIN_ALTITUDE_DEG, 0, 85)
    limit = int(_number(body, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT))
    rows = _selected(body, latitude, min_altitude)

    timescale, ephemeris = skyfield_context()
    site = wgs84.latlon(latitude, longitude)
    observer = ephemeris["earth"] + site
    # Local solar noon to the next local solar noon holds exactly one night.
    day_start = datetime(night.year, night.month, night.day, 12, tzinfo=timezone.utc) - timedelta(hours=longitude / 15.0)
    sun_times = _times(timescale, day_start, SUN_STEP_MINUTES, 24 * 60 // SUN_STEP_MINUTES + 1)
    sun_altitudes = observer.at(sun_times).observe(ephemeris["sun"]).apparent().altaz()[0].degrees

    twilight: dict[str, dict[str, str | None] | None] = {}
    darkness = "none"
    window: tuple[datetime, datetime] | None = None
    for name, level in TWILIGHTS:
        interval = _dark_interval(day_start, sun_altitudes, level)
        twilight[name] = None if interval is None else {
            "dusk_utc": isoformat_utc(interval[0]) if interval[0] else None,
            "dawn_utc": isoformat_utc(interval[1]) if interval[1] else None,
        }
        if interval is not None and window is None:
            darkness = name
            window = (interval[0] or day_start, interval[1] or day_start + timedelta(days=1))

    payload: dict[str, Any] = {
        "date": night.isoformat(),
        "min_altitude_deg": min_altitude,
        "darkness": darkness,
        "twilight": twilight,
        "window": None,
        "moon": None,
        "total": 0,
        "targets": [],
        "accuracy_note": ACCURACY_NOTE,
    }
    if window is None:
        return payload

    start, end = window
    payload["window"] = {"start_utc": isoformat_utc(start), "end_utc": isoformat_utc(end)}
    # The first sample is at dusk and the last sample is at dawn, so the step is five minutes or less.
    count = max(2, math.ceil((end - start).total_seconds() / (TARGET_STEP_MINUTES * 60)) + 1)
    step_minutes = (end - start).total_seconds() / 60 / (count - 1)
    times = _times(timescale, start, step_minutes, count)
    moon = observer.at(times).observe(ephemeris["moon"]).apparent()
    moon_altitudes = moon.altaz()[0].degrees
    moon_directions = moon.position.au / np.linalg.norm(moon.position.au, axis=0)
    payload["moon"] = {
        "illuminated_fraction": float(almanac.fraction_illuminated(ephemeris, "moon", times[count // 2])),
        "windows": _windows(start, step_minutes, moon_altitudes, 0.0),
    }
    if not rows:
        return payload

    right_ascension = np.radians([row["ra_deg"] for row in rows])
    declination = np.radians([row["dec_deg"] for row in rows])
    directions = np.stack([np.cos(declination) * np.cos(right_ascension), np.cos(declination) * np.sin(right_ascension), np.sin(declination)], axis=1)
    # The third row of the site rotation is the local zenith in the GCRS frame of the catalog directions.
    zenith = site.rotation_at(times)[2]
    altitudes = np.degrees(np.arcsin(np.clip(directions @ zenith, -1.0, 1.0)))
    minutes = _minutes_above(altitudes - min_altitude, step_minutes)
    visible = np.flatnonzero(minutes > 0)
    magnitudes = [rows[index]["magnitude"] if rows[index]["magnitude"] is not None else math.inf for index in visible.tolist()]
    order = sorted(range(len(visible)), key=lambda item: (-round(float(minutes[visible[item]])), magnitudes[item], rows[visible[item]]["key"]))
    payload["total"] = int(len(visible))
    targets = []
    for position in order[:limit]:
        index = int(visible[position])
        row = rows[index]
        best = int(np.argmax(altitudes[index]))
        separation = math.degrees(math.acos(float(np.clip(directions[index] @ moon_directions[:, best], -1.0, 1.0))))
        targets.append({
            **{name: row[name] for name in ("key", "name", "object_type", "constellation", "catalog", "ra_deg", "dec_deg", "magnitude", "size_arcmin")},
            "minutes_above": round(float(minutes[index]), 1),
            "windows": _windows(start, step_minutes, altitudes[index], min_altitude),
            "best_utc": isoformat_utc(start + timedelta(minutes=step_minutes * best)),
            "best_altitude_deg": round(float(altitudes[index, best]), 2),
            "moon_separation_deg": round(separation, 1),
        })
    payload["targets"] = targets
    return payload
