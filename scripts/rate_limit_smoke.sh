#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
TARGET_PATH="${TARGET_PATH:-/api/catalog/search?q=sun&limit=1}"
CONCURRENCY="${CONCURRENCY:-20}"
REQUEST_COUNT="${REQUEST_COUNT:-120}"
CURL_TIMEOUT="${CURL_TIMEOUT:-15}"

case "$CONCURRENCY:$REQUEST_COUNT" in
  *[!0-9:]*|0:*|*:0) echo "CONCURRENCY and REQUEST_COUNT must be positive integers" >&2; exit 2 ;;
esac

base="${BASE_URL%/}"
target="${base}${TARGET_PATH}"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

echo "Rate-limit smoke: ${REQUEST_COUNT} safe GET requests to ${target} at concurrency ${CONCURRENCY}"
baseline="$(curl --silent --show-error --output /dev/null --max-time "$CURL_TIMEOUT" --write-out '%{http_code}' "$target")"
if [[ ! "$baseline" =~ ^2[0-9][0-9]$ ]]; then
  echo "FAIL: baseline GET returned HTTP ${baseline}; refusing to run burst" >&2
  exit 1
fi

export target workdir CURL_TIMEOUT
seq 1 "$REQUEST_COUNT" | xargs -P "$CONCURRENCY" -I '{}' bash -c '
  code="$(curl --silent --output /dev/null --max-time "$CURL_TIMEOUT" --write-out "%{http_code}" "$target" || printf 000)"
  printf "%s\n" "$code" > "$workdir/{}.status"
'

successes="$(awk '/^2[0-9][0-9]$/{n++} END{print n+0}' "$workdir"/*.status)"
limited="$(awk '$0==429{n++} END{print n+0}' "$workdir"/*.status)"
unexpected="$(awk '!/^2[0-9][0-9]$/ && $0!=429{n++} END{print n+0}' "$workdir"/*.status)"

echo "Observed: baseline_success=1 burst_success=${successes} rate_limited=${limited} unexpected=${unexpected}"
if (( unexpected > 0 )); then
  echo "FAIL: unexpected response codes: $(sort "$workdir"/*.status | uniq -c | tr '\n' ' ')" >&2
  exit 1
fi
if (( limited == 0 )); then
  echo "FAIL: no HTTP 429 response observed. Increase REQUEST_COUNT/CONCURRENCY or verify the configured limiter and TARGET_PATH." >&2
  exit 1
fi
echo "PASS: safe GETs succeeded and the synthetic burst produced HTTP 429 responses."
