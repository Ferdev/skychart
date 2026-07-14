from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.catalog_sources import (
    BODY_BY_KEY,
    CATALOG_GROUPS,
    DEFAULT_CATALOG_GROUPS,
    DEFAULT_TRAIL_BODIES,
    DEFAULT_TRAIL_DAYS,
    DEFAULT_TRAIL_STEP_DAYS,
    MAX_TRAIL_DAYS,
    MAX_TRAIL_STEP_DAYS,
    MIN_TRAIL_DAYS,
    MIN_TRAIL_STEP_DAYS,
)
from backend.errors import QueryInputError
from backend.settings import LIVE_TIMESTAMP_BUCKET_SECONDS
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
