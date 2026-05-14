#!/usr/bin/env bash
set -Eeuo pipefail

export PYTHONUNBUFFERED=1

/app/.venv/bin/python /app/backend/server.py &
python_pid=$!

cleanup() {
  kill "$python_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

/app/scripts/import_catalogs_if_needed.sh

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8765/api/health >/dev/null; then
    break
  fi

  if [[ "$attempt" == "30" ]]; then
    echo "Python ephemeris backend did not become ready." >&2
    exit 1
  fi

  sleep 1
done

warm_url="http://127.0.0.1:8765/api/ephemeris?groups=core,mars_moons,jupiter_major_moons,saturn_major_moons,nearby_exoplanet_systems,messier_deep_sky"
for attempt in $(seq 1 3); do
  if curl -fsS "$warm_url" >/dev/null; then
    break
  fi

  if [[ "$attempt" == "3" ]]; then
    echo "Python ephemeris warmup failed." >&2
    exit 1
  fi

  sleep 2
done

exec /app/bin/starsmap_api start
