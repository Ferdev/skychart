import contextlib
import io
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import backend.http_transport
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

    def request_log(self, method, *args):
        handler = object.__new__(Handler)
        handler.requestline = args[0] if args else ""
        handler.client_address = ("127.0.0.1", 1)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            getattr(handler, method)(*args[1:])
        return output.getvalue()

    def test_request_log_omits_the_observer_site(self):
        line = "GET /api/observe?key=mars&lat=12.3456&lon=-65.4321 HTTP/1.1"
        output = self.request_log("log_request", line, 200)
        self.assertIn('"GET /api/observe HTTP/1.1" 200', output)
        self.assertNotIn("12.3456", output)
        self.assertNotIn("65.4321", output)

    def test_error_log_omits_the_observer_site(self):
        handler = object.__new__(Handler)
        handler.client_address = ("127.0.0.1", 1)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            handler.log_error("code %d, message %s", 400, "Bad request syntax ('GET /api/observe?lat=12.3456 &lon=-65.4321 HTTP/1.1')")
        self.assertIn("/api/observe HTTP/1.1", output.getvalue())
        self.assertNotIn("12.3456", output.getvalue())
        self.assertNotIn("65.4321", output.getvalue())

    def test_request_log_keeps_the_query_of_other_routes(self):
        output = self.request_log("log_request", "GET /api/trails?key=mars HTTP/1.1", 200)
        self.assertIn("/api/trails?key=mars", output)

    def test_catalog_objects_are_built_only_on_a_cache_miss(self):
        def get(path):
            handler = object.__new__(Handler)
            handler.path = path
            responses = []
            handler.respond = lambda payload, status=200: responses.append((status, payload))
            handler.do_GET()
            return responses[0]

        objects = [{"key": "sun", "catalog_group": "core"}]
        with tempfile.TemporaryDirectory() as directory, mock.patch(
            "backend.payload_cache.CACHE_DIR", Path(directory)
        ), mock.patch.object(
            backend.http_transport, "catalog_objects_for_groups", return_value=objects
        ) as build_objects, mock.patch.object(
            backend.http_transport,
            "catalog_summary_payload",
            side_effect=lambda groups, items, include_objects: {"groups": groups, "object_count": len(items)},
        ):
            first_status, first = get("/api/catalog?groups=core&include_objects=false")
            second_status, second = get("/api/catalog?groups=core&include_objects=false")
            self.assertEqual(build_objects.call_count, 1)
            get("/api/catalog?groups=core&include_objects=true")
            self.assertEqual(build_objects.call_count, 2)

        self.assertEqual((first_status, second_status), (200, 200))
        self.assertFalse(first["cache"]["hit"])
        self.assertTrue(second["cache"]["hit"])
        self.assertEqual({**first, "cache": None}, {**second, "cache": None})
        self.assertEqual(first["object_count"], 1)

    def test_catalog_object_failure_uses_the_error_response(self):
        handler = object.__new__(Handler)
        handler.path = "/api/catalog?groups=core"
        handler.headers = {}
        responses = []
        handler.respond = lambda payload, status=200: responses.append((status, payload))
        with tempfile.TemporaryDirectory() as directory, mock.patch(
            "backend.payload_cache.CACHE_DIR", Path(directory)
        ), mock.patch.object(
            backend.http_transport, "catalog_objects_for_groups", side_effect=RuntimeError("catalog failed")
        ), mock.patch.object(Handler, "log_internal_error") as log_error:
            handler.do_GET()
        log_error.assert_called_once_with("catalog response")
        self.assertEqual(responses[0][0], 500)
        self.assertEqual(responses[0][1]["error"], "catalog response failed")

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
