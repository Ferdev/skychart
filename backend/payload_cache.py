from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any, Callable

from backend.settings import CACHE_DIR, CACHE_SCHEMA_VERSION, LIVE_TIMESTAMP_BUCKET_SECONDS


_cache_lock = threading.Lock()


def cache_key_payload(kind: str, **parts: Any) -> dict[str, Any]:
    return {"schema_version": CACHE_SCHEMA_VERSION, "kind": kind, **parts}


def cache_path(namespace: str, key: dict[str, Any], cache_dir: Path | None = None) -> Path:
    serialized = json.dumps(key, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return (cache_dir or CACHE_DIR) / namespace / f"{digest}.json"


def read_cache(namespace: str, key: dict[str, Any], cache_dir: Path | None = None) -> dict[str, Any] | None:
    path = cache_path(namespace, key, cache_dir)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def write_cache(
    namespace: str,
    key: dict[str, Any],
    payload: dict[str, Any],
    cache_dir: Path | None = None,
) -> None:
    path = cache_path(namespace, key, cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    temporary_path.replace(path)


def cached_payload(
    namespace: str,
    key: dict[str, Any],
    builder: Callable[[], dict[str, Any]],
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    with _cache_lock:
        cached = read_cache(namespace, key, cache_dir)
        if cached is not None:
            return payload_with_cache_metadata(cached, True, namespace)

        payload = builder()
        write_cache(namespace, key, payload, cache_dir)
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
