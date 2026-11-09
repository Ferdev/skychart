"""Locks, sampling and memory bounds of the scientific backend."""
import hashlib
import http.server
import io
import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from skyfield.api import Star, wgs84

from backend import bounded_cache, kernel_download
from backend import scientific_calculation as science
from backend import spacecraft as sc
from backend.catalog_sources import BODY_BY_KEY

KERNEL = "mar099s.bsp"
KERNEL_BYTES = b"kernel bytes"
EPOCH = datetime(2026, 9, 6, tzinfo=timezone.utc)


class BlockingResponse(io.BytesIO):
    """A download that waits for a signal before it gives its bytes."""

    def __init__(self, release: threading.Event, started: threading.Event) -> None:
        super().__init__(b"kernel bytes")
        self.release = release
        self.started = started

    def read(self, *args):
        self.started.set()
        self.release.wait(5)
        return super().read(*args)


class SatelliteKernelDownloadTest(unittest.TestCase):
    def setUp(self):
        # The planetary ephemeris loads from the real data directory before the patch.
        science.skyfield_context()
        self.kernels = dict(science._satellite_kernels)
        science._satellite_kernels.clear()
        self.directory = tempfile.TemporaryDirectory()
        self.data_dir = patch.object(science, "DATA_DIR", Path(self.directory.name))
        self.data_dir.start()
        self.digests = patch.dict(science.SATELLITE_KERNEL_SHA256, {KERNEL: hashlib.sha256(KERNEL_BYTES).hexdigest()})
        self.digests.start()

    def tearDown(self):
        self.digests.stop()
        self.data_dir.stop()
        self.directory.cleanup()
        science._satellite_kernels.clear()
        science._satellite_kernels.update(self.kernels)

    def test_a_blocked_download_does_not_hold_the_ephemeris_lock(self):
        release, started = threading.Event(), threading.Event()
        loaded = object()
        with (
            patch.object(kernel_download, "urlopen", return_value=BlockingResponse(release, started)) as urlopen,
            patch.object(science, "load_file", return_value=loaded),
        ):
            result = {}
            worker = threading.Thread(target=lambda: result.update(kernel=science.satellite_kernel(KERNEL)))
            worker.start()
            self.assertTrue(started.wait(5))

            began = time.monotonic()
            self.assertEqual(len(science.skyfield_context()), 2)
            self.assertLess(time.monotonic() - began, 1)
            self.assertTrue(science._kernel_lock.acquire(timeout=1))
            science._kernel_lock.release()

            release.set()
            worker.join(5)

        self.assertIs(result["kernel"], loaded)
        self.assertEqual(urlopen.call_args.kwargs["timeout"], kernel_download.KERNEL_DOWNLOAD_TIMEOUT_SECONDS)

    def test_two_first_requests_publish_one_file(self):
        release, started = threading.Event(), threading.Event()
        loaded = object()
        with (
            patch.object(kernel_download, "urlopen", return_value=BlockingResponse(release, started)) as urlopen,
            patch.object(science, "load_file", return_value=loaded),
        ):
            results = []
            workers = [threading.Thread(target=lambda: results.append(science.satellite_kernel(KERNEL))) for _ in range(2)]
            for worker in workers:
                worker.start()
            self.assertTrue(started.wait(5))
            release.set()
            for worker in workers:
                worker.join(5)

        self.assertEqual(results, [loaded, loaded])
        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(sorted(p.name for p in Path(self.directory.name).iterdir()), [KERNEL])
        self.assertEqual((Path(self.directory.name) / KERNEL).read_bytes(), b"kernel bytes")

    def test_a_failed_download_leaves_no_file_and_the_next_request_tries_again(self):
        with patch.object(kernel_download, "urlopen", side_effect=TimeoutError("stalled")):
            with self.assertRaises(TimeoutError):
                science.satellite_kernel(KERNEL)
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

        loaded = object()
        with (
            patch.object(kernel_download, "urlopen", return_value=io.BytesIO(b"kernel bytes")),
            patch.object(science, "load_file", return_value=loaded),
        ):
            self.assertIs(science.satellite_kernel(KERNEL), loaded)

    def test_a_kernel_with_another_digest_is_not_published(self):
        with patch.object(kernel_download, "urlopen", return_value=io.BytesIO(b"tampered bytes")):
            with self.assertRaises(kernel_download.KernelDigestError):
                science.satellite_kernel(KERNEL)
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])
        self.assertNotIn(KERNEL, science._satellite_kernels)

    def test_each_kernel_url_has_a_digest(self):
        self.assertEqual(set(science.SATELLITE_KERNEL_URLS), set(science.SATELLITE_KERNEL_SHA256))


class KernelDigestHttpTest(unittest.TestCase):
    """The download from a local HTTP server, with no patch of urlopen."""

    def setUp(self):
        body = self.body = {"value": KERNEL_BYTES}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(body["value"])))
                self.end_headers()
                self.wfile.write(body["value"])

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/{KERNEL}"
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / KERNEL

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.directory.cleanup()

    def test_a_wrong_body_publishes_nothing_and_leaves_no_temporary_file(self):
        self.body["value"] = b"kernel bytez"
        with self.assertRaises(kernel_download.KernelDigestError):
            kernel_download.download_kernel(self.url, self.path, hashlib.sha256(KERNEL_BYTES).hexdigest())
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    def test_a_truncated_body_publishes_nothing(self):
        self.body["value"] = KERNEL_BYTES[:-1]
        with self.assertRaises(kernel_download.KernelDigestError):
            kernel_download.download_kernel(self.url, self.path, hashlib.sha256(KERNEL_BYTES).hexdigest())
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    def test_the_expected_body_is_published(self):
        kernel_download.download_kernel(self.url, self.path, hashlib.sha256(KERNEL_BYTES).hexdigest())
        self.assertEqual([p.name for p in Path(self.directory.name).iterdir()], [KERNEL])
        self.assertEqual(self.path.read_bytes(), KERNEL_BYTES)


class ObserveSamplingTest(unittest.TestCase):
    def reference(self, key, latitude, longitude, timestamp):
        """The earlier sampling: one Skyfield evaluation for each of the 289 times."""
        item = BODY_BY_KEY[key]
        timescale, ephemeris = science.skyfield_context()
        observer = ephemeris["earth"] + wgs84.latlon(latitude, longitude)
        if item.get("ra_deg") is not None and item.get("dec_deg") is not None:
            target = Star(ra_hours=float(item["ra_deg"]) / 15.0, dec_degrees=float(item["dec_deg"]))
        else:
            target = science.target_for_body(item, ephemeris)
        samples = []
        for i in range(289):
            at = timestamp + timedelta(minutes=5 * i)
            altitude, azimuth, _ = observer.at(timescale.from_datetime(at)).observe(target).apparent().altaz()
            samples.append((at, float(altitude.degrees), float(azimuth.degrees)))
        return samples

    def test_one_evaluation_gives_the_same_rise_transit_and_set(self):
        timestamp = datetime(2026, 11, 3, 21, 17, tzinfo=timezone.utc)
        for key, latitude, longitude in (("moon", 51.5, -0.1), ("mars", -33.9, 18.4)):
            payload = science.observe_payload(key, latitude, longitude, timestamp)
            samples = self.reference(key, latitude, longitude, timestamp)
            transit = max(samples, key=lambda row: row[1])[0]
            self.assertEqual(payload["transit_utc"], science.isoformat_utc(transit))
            rises = [b[0] for a, b in zip(samples, samples[1:]) if a[1] <= 0 < b[1]]
            sets = [b[0] for a, b in zip(samples, samples[1:]) if a[1] >= 0 > b[1]]
            self.assertEqual(payload["rise_utc"], science.isoformat_utc(rises[0]) if rises else None)
            self.assertEqual(payload["set_utc"], science.isoformat_utc(sets[0]) if sets else None)


class SpacecraftMemoryCacheTest(unittest.TestCase):
    def setUp(self):
        with sc._lock:
            self.results = dict(sc._results)
            sc._results.clear()

    def tearDown(self):
        with sc._lock:
            sc._results.clear()
            sc._results.update(self.results)

    def test_a_disk_cache_hit_is_read_once(self):
        cached = {"expires_at": time.time() + 3600, "body": {"key": "cached"}}
        with (
            patch.object(sc, "_worker", True),
            patch.object(sc, "in_coverage", return_value=True),
            patch.object(sc, "read_cache", return_value=cached) as read_cache,
        ):
            first = sc.spacecraft_payload(EPOCH)
            second = sc.spacecraft_payload(EPOCH)

        self.assertEqual(read_cache.call_count, len(sc.MISSIONS))
        self.assertEqual(first["bodies"], second["bodies"])
        self.assertEqual(len(sc._results), len(sc.MISSIONS))

    def test_an_expired_disk_result_stays_out_of_memory(self):
        expired = {"expires_at": time.time() - 1, "body": {"key": "old"}}
        with (
            patch.object(sc, "_worker", True),
            patch.object(sc, "in_coverage", return_value=True),
            patch.object(sc, "read_cache", return_value=expired),
            patch.object(sc, "_jobs") as jobs,
        ):
            jobs.full.return_value = True
            jobs.qsize.return_value = jobs.maxsize = 256
            sc.spacecraft_payload(EPOCH)
        self.assertEqual(sc._results, {})

    def test_memory_keeps_its_bound(self):
        with sc._lock:
            for i in range(sc._MAX_RESULTS + 20):
                sc._remember(("mission", str(i)), {"expires_at": 0, "body": {}})
            self.assertEqual(len(sc._results), sc._MAX_RESULTS)
            self.assertNotIn(("mission", "0"), sc._results)
            sc._remember(("mission", str(sc._MAX_RESULTS + 19)), {"expires_at": 1, "body": {}})
            self.assertEqual(len(sc._results), sc._MAX_RESULTS)
            self.assertIn(("mission", "20"), sc._results)


class HorizonsVectorCacheTest(unittest.TestCase):
    def test_the_cache_drops_the_least_recently_used_entry(self):
        cache = science.BoundedVectorCache(3)
        for i in range(3):
            cache.put(("ceres", str(i)), {"x": float(i)})
        self.assertEqual(cache.get(("ceres", "0")), {"x": 0.0})
        cache.put(("ceres", "3"), {"x": 3.0})
        self.assertEqual(len(cache), 3)
        self.assertNotIn(("ceres", "1"), cache)
        self.assertIn(("ceres", "0"), cache)

    def test_spacecraft_entries_of_an_earlier_day_are_removed(self):
        cache = science.BoundedVectorCache(100)
        with patch.object(bounded_cache, "utc_day", return_value="2026-11-03"):
            cache.put(("-31@500@0:frame:sha:2026-11-03", "t"), {"x": 1.0})
            cache.put(("1;@500@10:j2000_ecliptic_v1", "t"), {"x": 2.0})
        with patch.object(bounded_cache, "utc_day", return_value="2026-11-04"):
            cache.put(("-31@500@0:frame:sha:2026-11-04", "t"), {"x": 3.0})
        self.assertNotIn(("-31@500@0:frame:sha:2026-11-03", "t"), cache)
        self.assertIn(("1;@500@10:j2000_ecliptic_v1", "t"), cache)
        self.assertIn(("-31@500@0:frame:sha:2026-11-04", "t"), cache)

    def test_many_timestamps_stay_within_the_bound(self):
        def horizons(url, timeout):
            result = "$$SOE\n X =1.0E+08 Y =2.0E+07 Z =3.0E+06\n VX= 1.0E+00 VY= 0.0E+00 VZ= 0.0E+00\n$$EOE"
            return io.BytesIO(json.dumps({"result": result}).encode())

        cache = science.BoundedVectorCache(5)
        with (
            patch.object(science, "_horizons_vectors", cache),
            patch.object(science, "urlopen", side_effect=horizons),
            patch.object(science, "read_cache", return_value=None),
            patch.object(science, "write_cache"),
        ):
            for minute in range(20):
                science.horizons_vector_payload(
                    {"key": "ceres", "name": "Ceres", "horizons_id": "1;", "parent_key": "sun"},
                    EPOCH + timedelta(minutes=minute),
                )
        self.assertEqual(len(cache), 5)


if __name__ == "__main__":
    unittest.main()
