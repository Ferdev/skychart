#!/usr/bin/env python3
"""SMP3 point-tile and SMPK1 packed-container primitives.

The module deliberately has no third-party dependencies so the production
image, offline Gaia encoder, and fixture tests use exactly the same codec.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping

SMP3_MAGIC = b"SMP3"
SMP3_VERSION = 1
SMP3_HEADER = struct.Struct("<4sHHddfI")
SMP3_RECORD = struct.Struct("<HHBBBB")
SMP3_HEADER_BYTES = SMP3_HEADER.size
SMP3_RECORD_BYTES = SMP3_RECORD.size

SMP3_FLAG_SOURCE_IDS = 1
SMP3_FLAG_EXTENTS = 2

SMPK1_MAGIC = b"SMPK1\0\0\0"
SMPK1_HEADER = struct.Struct("<8sII")
SMPK1_ENTRY = struct.Struct("<B3xiiQI")


@dataclass(frozen=True, order=True)
class TileKey:
    span_log2: int
    x: int
    y: int


@dataclass(frozen=True)
class ContainerEntry:
    key: TileKey
    offset: int
    length: int


def encode_magnitude(value: float | None) -> int:
    if value is None or not math.isfinite(value):
        return 255
    return max(0, min(255, round((value + 2.0) * 10.0)))


def decode_magnitude(value: int) -> float | None:
    return None if value == 255 else value / 10.0 - 2.0


def encode_extent_ly(value: float | None) -> int:
    if value is None or not math.isfinite(value) or value <= 0:
        return 0
    return max(1, min(255, round(math.log2(value) * 16.0 + 64.0)))


def decode_extent_ly(value: int) -> float:
    return 0.0 if value == 0 else 2.0 ** ((value - 64.0) / 16.0)


def quantize_position(value: float, origin: float, span: float) -> int:
    if span <= 0:
        raise ValueError("SMP3 tile span must be positive")
    return max(0, min(65535, round((value - origin) / span * 65535.0)))


def encode_tile(
    key: TileKey,
    records: Iterable[tuple[float, float, int, int, int, int, int]],
    *,
    include_source_ids: bool = False,
) -> bytes:
    """Encode records `(x, y, mag, color, type, extent, source_id)`.

    Callers must provide magnitude order. Enforcing it here makes prefix Range
    reads a codec invariant rather than merely a builder convention.
    """
    span = float(2**key.span_log2)
    origin_x = float(key.x) * span
    origin_y = float(key.y) * span
    rows = list(records)
    if any(rows[index][2] > rows[index + 1][2] for index in range(len(rows) - 1)):
        raise ValueError("SMP3 records must be sorted by encoded magnitude")
    flags = SMP3_FLAG_EXTENTS if any(row[5] for row in rows) else 0
    if include_source_ids:
        flags |= SMP3_FLAG_SOURCE_IDS
    payload = bytearray(SMP3_HEADER.pack(SMP3_MAGIC, SMP3_VERSION, flags, origin_x, origin_y, span, len(rows)))
    source_ids: list[int] = []
    for x_au, y_au, mag, color_idx, type_code, extent, source_id in rows:
        payload.extend(
            SMP3_RECORD.pack(
                quantize_position(x_au, origin_x, span),
                quantize_position(y_au, origin_y, span),
                mag,
                color_idx,
                type_code,
                extent,
            )
        )
        if include_source_ids:
            source_ids.append(max(0, int(source_id)))
    if include_source_ids:
        payload.extend(struct.pack(f"<{len(source_ids)}Q", *source_ids))
    return bytes(payload)


def write_container(path: Path, tiles: Mapping[TileKey, bytes]) -> list[ContainerEntry]:
    """Write deterministic SMPK1: fixed index followed by clustered tile data."""
    ordered = sorted(tiles.items())
    data_offset = SMPK1_HEADER.size + len(ordered) * SMPK1_ENTRY.size
    entries: list[ContainerEntry] = []
    cursor = data_offset
    for key, payload in ordered:
        entries.append(ContainerEntry(key, cursor, len(payload)))
        cursor += len(payload)

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.write(SMPK1_HEADER.pack(SMPK1_MAGIC, 1, len(entries)))
        for entry in entries:
            handle.write(
                SMPK1_ENTRY.pack(
                    entry.key.span_log2,
                    entry.key.x,
                    entry.key.y,
                    entry.offset,
                    entry.length,
                )
            )
        for _, payload in ordered:
            handle.write(payload)
    return entries


def write_container_from_paths(path: Path, tiles: Mapping[TileKey, Path]) -> list[ContainerEntry]:
    """Pack disk-spooled tiles without retaining a billion-star layer in RAM."""
    ordered = sorted(tiles.items())
    data_offset = SMPK1_HEADER.size + len(ordered) * SMPK1_ENTRY.size
    entries: list[ContainerEntry] = []
    cursor = data_offset
    for key, tile_path in ordered:
        length = tile_path.stat().st_size
        entries.append(ContainerEntry(key, cursor, length))
        cursor += length
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.write(SMPK1_HEADER.pack(SMPK1_MAGIC, 1, len(entries)))
        for entry in entries:
            handle.write(SMPK1_ENTRY.pack(entry.key.span_log2, entry.key.x, entry.key.y, entry.offset, entry.length))
        for _, tile_path in ordered:
            with tile_path.open("rb") as tile:
                while chunk := tile.read(8 * 1024 * 1024):
                    handle.write(chunk)
    return entries


def read_container_index(buffer: bytes) -> list[ContainerEntry]:
    if len(buffer) < SMPK1_HEADER.size:
        raise ValueError("SMPK1 header is truncated")
    magic, version, count = SMPK1_HEADER.unpack_from(buffer)
    if magic != SMPK1_MAGIC or version != 1:
        raise ValueError("Unknown SMPK container")
    expected = SMPK1_HEADER.size + count * SMPK1_ENTRY.size
    if len(buffer) < expected:
        raise ValueError("SMPK1 index is truncated")
    return [
        ContainerEntry(TileKey(span, x, y), offset, length)
        for span, x, y, offset, length in SMPK1_ENTRY.iter_unpack(buffer[SMPK1_HEADER.size:expected])
    ]
