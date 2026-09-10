#!/usr/bin/env python3
"""Measure a local Postgres source-record prototype using real snapshot samples.

All writes are to a temporary table in a rolled-back transaction. Repeated
samples have synthetic IDs and are NOT a full-release or browser benchmark.
"""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def measure(sample, count):
    # No remote/production connection or URL credential handling in this probe.
    if (any(os.environ.get(key) for key in ("DATABASE_URL", "PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR"))
            or os.environ.get("PGHOST", "localhost") not in {"localhost", "127.0.0.1", "::1", "/var/run/postgresql"}):
        raise ValueError("probe is restricted to an explicit local libpq database")
    if not os.environ.get("PGDATABASE"):
        raise ValueError("set PGDATABASE to the local development database")
    if not sample or not 1 <= count <= 100_000:
        raise ValueError("probe requires samples and 1..100000 records")
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as script:
        script.write("""BEGIN;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='1s';
SET LOCAL work_mem='8MB';
CREATE TEMP TABLE catalog_capacity_probe (LIKE catalog_record_versions INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE catalog_capacity_times (phase text, started timestamptz, elapsed_ms float8) ON COMMIT DROP;
INSERT INTO catalog_capacity_times VALUES ('copy',clock_timestamp(),NULL);
COPY catalog_capacity_probe (record_key,provider,catalog,release,source_id,record) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t');
""")
        writer = csv.writer(script, delimiter="\t", lineterminator="\n")
        serialized_bytes = 0
        first_key = None
        for index in range(count):
            source_id = str(index)
            key = hashlib.sha256(f"probe:{index}".encode()).hexdigest()
            if first_key is None:
                first_key = key
            payload = json.dumps(sample[index % len(sample)], separators=(",", ":"), allow_nan=False)
            serialized_bytes += len(payload.encode())
            writer.writerow([key, "benchmark", "sample", "unadmitted", source_id, payload])
        script.write("\\.\n")
        script.write("""UPDATE catalog_capacity_times SET elapsed_ms=extract(epoch FROM clock_timestamp()-started)*1000 WHERE phase='copy';
ANALYZE catalog_capacity_probe;
DO $$ DECLARE started_at timestamptz; BEGIN
FOR i IN 1..100 LOOP
started_at := clock_timestamp();
""")
        # first_key is an internally generated SHA-256, never caller SQL.
        script.write(f"PERFORM record FROM catalog_capacity_probe WHERE record_key='{first_key}';\n")
        script.write("""INSERT INTO catalog_capacity_times VALUES ('exact_lookup',started_at,extract(epoch FROM clock_timestamp()-started_at)*1000);
END LOOP;
END $$;
SELECT json_build_object(
 'rows', (SELECT count(*) FROM catalog_capacity_probe),
 'table_bytes',pg_table_size('catalog_capacity_probe'),
 'index_bytes',pg_indexes_size('catalog_capacity_probe'),
 'total_bytes',pg_total_relation_size('catalog_capacity_probe'),
 'copy_ms',(SELECT elapsed_ms FROM catalog_capacity_times WHERE phase='copy'),
 'warm_exact_lookup_p95_ms',(SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_ms) FROM catalog_capacity_times WHERE phase='exact_lookup')
);
ROLLBACK;
""")
        script.seek(0)
        started = time.monotonic()
        result = subprocess.run(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
                                stdin=script, capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise RuntimeError("local capacity probe failed; inspect local schema/permissions, no credentials emitted")
        metrics = next(json.loads(line) for line in result.stdout.splitlines() if line.startswith("{"))
        metrics.update(wall_seconds=time.monotonic()-started, serialized_source_bytes=serialized_bytes,
                       bytes_per_record=metrics["total_bytes"]/count,
                       records_per_second=count/(metrics["copy_ms"]/1000))
        return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--scales", default="1000,10000")
    args = parser.parse_args()
    if args.snapshot.stat().st_size > 128 * 1024**2:
        parser.error("use a bounded reference snapshot under 128 MiB")
    snapshot = json.loads(args.snapshot.read_text())
    sample = snapshot.get("stars", snapshot.get("objects", snapshot.get("systems", [])))
    measurements = [measure(sample, int(n)) for n in args.scales.split(",")]
    print(json.dumps({"schema_version":1, "sample_sha256":hashlib.sha256(args.snapshot.read_bytes()).hexdigest(),
        "scope":"local prototype with repeated sampled rows and synthetic IDs; not full-volume validation",
        "capacity_approved":False, "measurements":measurements,
        "unmeasured":["full scientific schema", "all first-set source populations", "angular and physical index costs",
                      "alias/text search", "cross-identification", "tile build", "browser/server API latency",
                      "temporary full-volume disk", "refresh cost", "actual release coexistence"]},indent=2))


if __name__ == '__main__':
    main()
