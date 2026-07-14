#!/usr/bin/env bash
set -euo pipefail
for base_url in "${STAGING_URL:-https://staging.skychart.org}" "${PRODUCTION_URL:-https://skychart.org}"; do
  response="$(curl --fail --silent --show-error --max-time 15 --retry 2 "${base_url%/}/api/health")"
  printf '%s %s\n' "$base_url" "$response"
done
