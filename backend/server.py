from __future__ import annotations

import json
from datetime import datetime, timezone
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

_loader: Loader | None = None
_timescale: Any | None = None
_ephemeris: Any | None = None


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
        "timestamp_utc": timestamp.isoformat().replace("+00:00", "Z"),
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data_source": "NASA/JPL DE440s ephemeris via Skyfield",
        "coordinate_frame": "Heliocentric ecliptic Cartesian coordinates, projected top-down as x/y; z retained for distance calculations",
        "units": {"distance": "kilometers", "position": "astronomical units and kilometers"},
        "au_km": AU_KM,
        "earth_position": earth_position,
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

        if parsed.path != "/api/ephemeris":
            self.respond({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            query = parse_qs(parsed.query)
            timestamp = parse_timestamp(query.get("timestamp", [None])[0])
            self.respond(ephemeris_payload(timestamp))
        except Exception as exc:
            self.respond({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

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
