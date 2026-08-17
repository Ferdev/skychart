from __future__ import annotations

import json
import logging
import os
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlparse

from backend.catalog_sources import (
    CATALOG_SEARCH_DEFAULT_LIMIT,
    CATALOG_SEARCH_MAX_LIMIT,
    STARTUP_CATALOG_GROUPS,
    catalog_objects_for_groups,
    catalog_summary_payload,
)
from backend.errors import QueryInputError
from backend.payload_cache import cache_key_payload, cached_payload
from backend.request_query import (
    parse_bool_param,
    parse_catalog_groups,
    parse_catalog_keys,
    parse_catalog_object_types,
    parse_int_param,
    parse_timestamp,
    parse_trails_query,
)
from backend.scientific_calculation import (
    catalog_search_payload,
    ephemeris_payload,
    isoformat_utc,
    observe_payload,
    orbits_payload,
    small_body_ephemeris_payload,
    trails_payload,
)

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

        if parsed.path == "/api/small-body-ephemeris":
            try:
                query = parse_qs(parsed.query, keep_blank_values=True)
                timestamp = parse_timestamp(query.get("timestamp", [None])[0])
                designation = query.get("designation", [""])[0].strip()
                if not re.fullmatch(r"[A-Za-z0-9 ./()+-]{1,80}", designation):
                    raise QueryInputError("designation is invalid")
                key = cache_key_payload(
                    "small_body_ephemeris",
                    timestamp_utc=isoformat_utc(timestamp),
                    designation=designation,
                )
                self.respond(cached_payload("api", key, lambda: small_body_ephemeris_payload(designation, timestamp)))
            except (QueryInputError, ValueError) as exc:
                self.respond({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            except Exception:
                self.log_internal_error("small-body ephemeris calculation")
                self.respond({"error": "small-body ephemeris calculation failed", "request_id": self.request_id()}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
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
