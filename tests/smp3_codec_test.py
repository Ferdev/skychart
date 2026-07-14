#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import smp3


def fixture(name: str) -> bytes:
    lines = (ROOT / "tests" / "fixtures" / "smp3" / name).read_text().splitlines()
    return bytes.fromhex("".join(line for line in lines if not line.startswith("#")))


class Smp3CodecTest(unittest.TestCase):
    def test_golden_tile_header_and_magnitude_prefix(self) -> None:
        payload = fixture("bright-stars.hex")
        magic, version, flags, origin_x, origin_y, span, count = smp3.SMP3_HEADER.unpack_from(payload)
        self.assertEqual((magic, version, flags, origin_x, origin_y, span, count), (b"SMP3", 1, 0, 0.0, 0.0, 1024.0, 3))
        magnitudes = [payload[smp3.SMP3_HEADER_BYTES + index * 8 + 4] for index in range(count)]
        self.assertEqual(magnitudes, sorted(magnitudes))
        self.assertEqual(magnitudes, [10, 20, 254])

    def test_golden_extent_tile_uses_eight_byte_records(self) -> None:
        payload = fixture("deep-sky-extents.hex")
        header = smp3.SMP3_HEADER.unpack_from(payload)
        self.assertTrue(header[2] & smp3.SMP3_FLAG_EXTENTS)
        self.assertEqual(len(payload), smp3.SMP3_HEADER_BYTES + header[6] * smp3.SMP3_RECORD_BYTES)

    def test_container_index_round_trip(self) -> None:
        tiles = {
            smp3.TileKey(24, -1, 2): fixture("bright-stars.hex"),
            smp3.TileKey(26, 3, -4): fixture("deep-sky-extents.hex"),
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.smpk"
            written = smp3.write_container(path, tiles)
            data = path.read_bytes()
            read = smp3.read_container_index(data)
        self.assertEqual(read, written)
        for entry in read:
            self.assertEqual(data[entry.offset:entry.offset + entry.length], tiles[entry.key])

    def test_encoder_rejects_non_prefix_lod_order(self) -> None:
        key = smp3.TileKey(10, 0, 0)
        with self.assertRaisesRegex(ValueError, "sorted by encoded magnitude"):
            smp3.encode_tile(key, [(0, 0, 20, 0, 0, 0, 0), (1, 1, 10, 0, 0, 0, 0)])


if __name__ == "__main__":
    unittest.main()
