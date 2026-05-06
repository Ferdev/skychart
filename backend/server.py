from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from skyfield.api import Loader
from skyfield.framelib import ecliptic_frame


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "skyfield"
HOST = "127.0.0.1"
PORT = 8765
AU_KM = 149_597_870.700

BODIES = [
    {"key": "sun", "name": "Sun", "ephemeris": "sun", "radius_km": 695_700, "color": "#ffd166"},
    {"key": "mercury", "name": "Mercury", "ephemeris": "mercury", "radius_km": 2_439.7, "color": "#b8a48a"},
    {"key": "venus", "name": "Venus", "ephemeris": "venus", "radius_km": 6_051.8, "color": "#d8b26f"},
    {"key": "earth", "name": "Earth", "ephemeris": "earth", "radius_km": 6_371.0, "color": "#62a8ff"},
    {"key": "moon", "name": "Moon", "ephemeris": "moon", "radius_km": 1_737.4, "color": "#c8c8c8"},
    {"key": "mars", "name": "Mars", "ephemeris": "mars barycenter", "radius_km": 3_389.5, "color": "#df6b43"},
    {"key": "jupiter", "name": "Jupiter", "ephemeris": "jupiter barycenter", "radius_km": 69_911, "color": "#d9b382"},
    {"key": "saturn", "name": "Saturn", "ephemeris": "saturn barycenter", "radius_km": 58_232, "color": "#d8c28a"},
    {"key": "uranus", "name": "Uranus", "ephemeris": "uranus barycenter", "radius_km": 25_362, "color": "#83d8d8"},
    {"key": "neptune", "name": "Neptune", "ephemeris": "neptune barycenter", "radius_km": 24_622, "color": "#6f8cff"},
]
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


def ephemeris_payload(timestamp: datetime) -> dict[str, Any]:
    timescale, ephemeris = skyfield_context()
    time = timescale.from_datetime(timestamp)
    sun = ephemeris["sun"]
    earth = ephemeris["earth"]

    bodies: list[dict[str, Any]] = []
    earth_position = None

    for item in BODIES:
        target = ephemeris[item["ephemeris"]]

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
        else:
            helio_vector = (target - sun).at(time)
            position = vector_payload(helio_vector)
            earth_distance_km = 0.0 if item["key"] == "earth" else float((target - earth).at(time).distance().km)

        if item["key"] == "earth":
            earth_position = position

        bodies.append(
            {
                "key": item["key"],
                "name": item["name"],
                "radius_km": item["radius_km"],
                "color": item["color"],
                "position": position,
                "distance_from_earth_km": earth_distance_km,
            }
        )

    return {
        "timestamp_utc": isoformat_utc(timestamp),
        "generated_at_utc": isoformat_utc(datetime.now(timezone.utc)),
        "data_source": "NASA/JPL DE440s ephemeris via Skyfield",
        "coordinate_frame": "Heliocentric ecliptic Cartesian coordinates, projected top-down as x/y; z retained for distance calculations",
        "units": {"distance": "kilometers", "position": "astronomical units and kilometers"},
        "au_km": AU_KM,
        "earth_position": earth_position,
        "bodies": bodies,
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
            target = ephemeris[item["ephemeris"]]
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
        "data_source": "NASA/JPL DE440s ephemeris via Skyfield",
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
                query = parse_qs(parsed.query)
                timestamp = parse_timestamp(query.get("timestamp", [None])[0])
                self.respond(ephemeris_payload(timestamp))
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
