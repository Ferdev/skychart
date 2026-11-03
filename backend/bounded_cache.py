"""A bounded in-memory cache of Horizons vectors."""
from __future__ import annotations

import re
import threading
from collections import OrderedDict
from datetime import datetime, timezone


def utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class BoundedVectorCache:
    """A thread-safe LRU cache of Horizons vectors with a fixed number of entries.

    A spacecraft key ends with the UTC day of its prediction. When the day changes, the entries
    of the earlier days are removed: no request reads them again.
    """

    _DAY_SUFFIX = re.compile(r":(\d{4}-\d{2}-\d{2})$")

    def __init__(self, max_entries: int) -> None:
        self.max_entries = max_entries
        self._entries: OrderedDict[tuple[str, str], dict[str, float]] = OrderedDict()
        self._lock = threading.Lock()
        self._day = ""

    def get(self, key: tuple[str, str]) -> dict[str, float] | None:
        with self._lock:
            value = self._entries.get(key)
            if value is not None:
                self._entries.move_to_end(key)
            return value

    def put(self, key: tuple[str, str], value: dict[str, float]) -> None:
        today = utc_day()
        with self._lock:
            if today != self._day:
                self._day = today
                for stale in [k for k in self._entries if self._stale(k[0], today)]:
                    del self._entries[stale]
            self._entries[key] = value
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def _stale(self, name: str, today: str) -> bool:
        match = self._DAY_SUFFIX.search(name)
        return match is not None and match.group(1) != today

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def __contains__(self, key: object) -> bool:
        with self._lock:
            return key in self._entries
