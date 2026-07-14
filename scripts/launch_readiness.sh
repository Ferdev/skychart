#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
OBJECT_PATH="${OBJECT_PATH:-/o/ngc-224}"
TOUR_ONE_PATH="${TOUR_ONE_PATH:-/tours/earth-to-observable-universe}"
TOUR_TWO_PATH="${TOUR_TWO_PATH:-/tours/near-the-sun}"
EMBED_PATH="${EMBED_PATH:-/embed}"
CURL_TIMEOUT="${CURL_TIMEOUT:-20}"
base="${BASE_URL%/}"
failures=0

check_get() {
  local label="$1" path="$2" expected="${3:-}"
  local body status
  body="$(mktemp)"
  status="$(curl --silent --show-error --location --max-time "$CURL_TIMEOUT" --output "$body" --write-out '%{http_code}' "${base}${path}" || true)"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]] && { [[ -z "$expected" ]] || grep -Eiq "$expected" "$body"; }; then
    echo "PASS ${label}: HTTP ${status} ${path}"
  else
    echo "FAIL ${label}: HTTP ${status:-curl-error} ${path}${expected:+; expected /${expected}/}" >&2
    failures=$((failures + 1))
  fi
  rm -f "$body"
}

headers_for() { curl --silent --show-error --head --max-time "$CURL_TIMEOUT" "${base}$1" | tr -d '\r'; }

check_get health /api/health 'ok|healthy'
check_get robots /robots.txt 'User-agent:'
check_get about /about 'Gaia|DESI'
check_get methodology /methodology 'How Cosmic Atlas represents the sky'
check_get sitemap /sitemap.xml '<sitemapindex|<urlset'
check_get object_permalink "$OBJECT_PATH" '<html|Cosmic Atlas'
check_get tours_index /tours '<html|Cosmic Atlas'
check_get tour_one "$TOUR_ONE_PATH" '<html|Cosmic Atlas'
check_get tour_two "$TOUR_TWO_PATH" '<html|Cosmic Atlas'
check_get atom_feed /feed.xml '<feed'

root_headers="$(headers_for / || true)"
if grep -Eiq '^x-frame-options:[[:space:]]*sameorigin' <<<"$root_headers"; then
  echo "PASS framing: root is SAMEORIGIN"
else
  echo "FAIL framing: root lacks X-Frame-Options: SAMEORIGIN" >&2
  failures=$((failures + 1))
fi
if grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' <<<"$root_headers"; then
  echo "PASS security: X-Content-Type-Options nosniff"
else
  echo "FAIL security: root lacks X-Content-Type-Options: nosniff" >&2
  failures=$((failures + 1))
fi

embed_headers="$(headers_for "$EMBED_PATH" || true)"
if grep -Eiq '^content-security-policy:.*frame-ancestors[[:space:]]+\*' <<<"$embed_headers" && ! grep -Eiq '^x-frame-options:' <<<"$embed_headers"; then
  echo "PASS framing: embed allows external framing without X-Frame-Options conflict"
else
  echo "FAIL framing: ${EMBED_PATH} must declare CSP frame-ancestors * and omit X-Frame-Options" >&2
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  echo "Launch readiness failed with ${failures} check(s)." >&2
  exit 1
fi
echo "Launch readiness HTTP checks passed for ${base}."
