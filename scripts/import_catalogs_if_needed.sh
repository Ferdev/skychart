#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

gaia_500pc_min_count="${GAIA_500PC_MIN_COUNT:-1597012}"
gaia_10kpc_min_count="${GAIA_10KPC_MIN_COUNT:-1339910}"
release_bin="${STARSMAP_RELEASE_BIN:-$repo_root/bin/starsmap_api}"

elixir_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

for command in python3 psql; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "[catalog-import] Missing required command: $command" >&2
    exit 127
  fi
done

echo "[catalog-import] Running Ecto migrations..."
if [ -x "$release_bin" ]; then
  "$release_bin" eval "StarsmapApi.Release.migrate()"
else
  if ! command -v mix >/dev/null 2>&1; then
    echo "[catalog-import] Missing required command: mix" >&2
    exit 127
  fi
  (
    cd "$repo_root/backend_phoenix"
    mix ecto.migrate
  )
fi

echo "[catalog-import] Importing checked-in catalog snapshots..."
if [ -x "$release_bin" ]; then
  escaped_root="$(elixir_string "$repo_root")"
  "$release_bin" eval "StarsmapApi.Release.import_catalogs([\"$escaped_root\"])"
else
  (
    cd "$repo_root/backend_phoenix"
    mix starsmap.import_catalogs "$repo_root"
  )
fi

echo "[catalog-import] Ensuring Gaia 500 pc bulk slice is present..."
python3 "$repo_root/scripts/import_gaia_bulk_catalog.py" \
  --preset 500pc-g14 \
  --skip-if-existing-at-least "$gaia_500pc_min_count"

echo "[catalog-import] Ensuring Gaia 10 kpc bright bulk slice is present..."
python3 "$repo_root/scripts/import_gaia_bulk_catalog.py" \
  --preset 10kpc-g12 \
  --skip-if-existing-at-least "$gaia_10kpc_min_count"

echo "[catalog-import] Refreshing catalog summary counts..."
if [ -x "$release_bin" ]; then
  "$release_bin" eval "StarsmapApi.Release.refresh_catalog_summary_counts()"
else
  (
    cd "$repo_root/backend_phoenix"
    mix run -e 'StarsmapApi.Catalog.refresh_summary_counts!()'
  )
fi

echo "[catalog-import] Final catalog summary:"
if [ "${CATALOG_IMPORT_SUMMARY:-1}" = "0" ]; then
  echo "[catalog-import] Skipping final catalog summary."
  exit 0
fi

if [ -x "$release_bin" ]; then
  if ! "$release_bin" eval '{:ok, _} = Application.ensure_all_started(:starsmap_api); IO.inspect(StarsmapApi.Catalog.summary(), label: "catalog")'; then
    echo "[catalog-import] Warning: final catalog summary failed after import checks completed." >&2
  fi
else
  if ! (
    cd "$repo_root/backend_phoenix"
    mix run -e 'IO.inspect(StarsmapApi.Catalog.summary(), label: "catalog")'
  ); then
    echo "[catalog-import] Warning: final catalog summary failed after import checks completed." >&2
  fi
fi
