#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

gaia_500pc_min_count="${GAIA_500PC_MIN_COUNT:-3016638}"
gaia_10kpc_min_count="${GAIA_10KPC_MIN_COUNT:-1928481}"
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

echo "[catalog-import] Final catalog summary:"
if [ -x "$release_bin" ]; then
  "$release_bin" eval '{:ok, _} = Application.ensure_all_started(:starsmap_api); IO.inspect(StarsmapApi.Catalog.summary(), label: "catalog")'
else
  (
    cd "$repo_root/backend_phoenix"
    mix run -e 'IO.inspect(StarsmapApi.Catalog.summary(), label: "catalog")'
  )
fi
