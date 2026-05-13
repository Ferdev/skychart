#!/usr/bin/env bash
set -Eeuo pipefail

export PYTHONUNBUFFERED=1

/app/.venv/bin/python /app/backend/server.py &
python_pid=$!

cleanup() {
  kill "$python_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

/app/bin/starsmap_api eval "StarsmapApi.Release.migrate()"
/app/bin/starsmap_api eval "StarsmapApi.Release.import_catalogs([\"/app\"])"

exec /app/bin/starsmap_api start
