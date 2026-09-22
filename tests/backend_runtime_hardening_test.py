import tempfile
import threading
import unittest
from pathlib import Path

from backend.http_transport import Handler
from backend.payload_cache import cached_payload


class DisconnectingWriter:
    def write(self, _body):
        raise BrokenPipeError("client left")


class BackendRuntimeHardeningTest(unittest.TestCase):
    def test_response_disconnect_is_terminal_and_quiet(self):
        handler = object.__new__(Handler)
        handler.wfile = DisconnectingWriter()
        handler.send_response = lambda _status: None
        handler.send_header = lambda _key, _value: None
        handler.end_headers = lambda: None
        self.assertFalse(handler.respond({"ok": True}))

    def test_cache_build_is_single_flight_under_concurrency(self):
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            calls = 0
            calls_lock = threading.Lock()
            barrier = threading.Barrier(6)

            def builder():
                nonlocal calls
                with calls_lock:
                    calls += 1
                return {"value": 42}

            results = []
            def worker():
                barrier.wait()
                results.append(cached_payload("test", {"key": "same"}, builder, cache_dir))

            threads = [threading.Thread(target=worker) for _ in range(6)]
            for thread in threads: thread.start()
            for thread in threads: thread.join()
        self.assertEqual(calls, 1)
        self.assertEqual(len(results), 6)
        self.assertEqual(sum(1 for result in results if not result["cache"]["hit"]), 1)

    def test_cache_builds_for_different_keys_can_run_concurrently(self):
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            first_started = threading.Event()
            second_started = threading.Event()
            overlapped = []

            def build_first():
                first_started.set()
                overlapped.append(second_started.wait(2))
                return {"value": 1}

            def build_second():
                second_started.set()
                overlapped.append(first_started.wait(2))
                return {"value": 2}

            threads = [
                threading.Thread(target=cached_payload, args=("test", {"key": "first"}, build_first, cache_dir)),
                threading.Thread(target=cached_payload, args=("test", {"key": "second"}, build_second, cache_dir)),
            ]
            for thread in threads: thread.start()
            for thread in threads: thread.join()

        self.assertEqual(overlapped, [True, True])


if __name__ == "__main__":
    unittest.main()
