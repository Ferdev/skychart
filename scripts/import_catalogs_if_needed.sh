#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

gaia_500pc_min_count="${GAIA_500PC_MIN_COUNT:-1597012}"
gaia_10kpc_min_count="${GAIA_10KPC_MIN_COUNT:-1339910}"
release_bin="${STARSMAP_RELEASE_BIN:-$repo_root/bin/starsmap_api}"
release_static_dir=""
if [ -d "$repo_root/lib" ]; then
  release_static_dir="$(find "$repo_root/lib" -maxdepth 3 -path '*/priv/static' -type d | head -n 1)"
fi

catalog_tile_version="${CATALOG_TILE_VERSION:-v1}"
default_tile_output="$repo_root/backend_phoenix/priv/static/catalog-tiles/$catalog_tile_version"
if [ -n "$release_static_dir" ]; then
  default_tile_output="$release_static_dir/catalog-tiles/$catalog_tile_version"
elif [ -d "$repo_root/priv/static" ]; then
  default_tile_output="$repo_root/priv/static/catalog-tiles/$catalog_tile_version"
fi
catalog_tile_output="${CATALOG_TILE_OUTPUT_DIR:-$default_tile_output}"
catalog_tile_public_base_url="${CATALOG_TILE_PUBLIC_BASE_URL:-/catalog-tiles/$catalog_tile_version}"
catalog_import_report_path="${CATALOG_IMPORT_REPORT_PATH:-$repo_root/tmp/catalog-import-report.json}"
export CATALOG_IMPORT_REPORT_PATH="$catalog_import_report_path"

elixir_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

psql_command() {
  local database_url="${DATABASE_URL:-}"
  if [[ "$database_url" == ecto://* ]]; then
    database_url="postgresql://${database_url#ecto://}"
  fi

  if [ -n "$database_url" ]; then
    psql -v ON_ERROR_STOP=1 --dbname "$database_url" "$@"
  else
    psql -v ON_ERROR_STOP=1 "$@"
  fi
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
    mix starsmap.import_catalogs --report "$catalog_import_report_path" "$repo_root"
  )
fi

echo "[catalog-import] Ensuring Gaia 500 pc bulk slice is present..."
python3 "$repo_root/scripts/import_gaia_bulk_catalog.py" \
  --preset 500pc-g14 \
  --skip-if-existing-at-least "$gaia_500pc_min_count"

echo "[catalog-import] Ensuring Gaia 10 kpc bright bulk slice is present..."
python3 "$repo_root/scripts/import_gaia_bulk_catalog.py" \
  --preset 10kpc-g14 \
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

if [ "${CATALOG_IMPORT_VACUUM:-1}" != "0" ]; then
  echo "[catalog-import] Vacuuming catalog query indexes..."
  psql_command <<'SQL'
SET maintenance_work_mem = '16MB';
VACUUM (ANALYZE, PARALLEL 0) catalog_objects;
SQL
fi

if [ "${CATALOG_STATIC_TILES:-0}" = "1" ]; then
  echo "[catalog-import] Building static catalog point tiles..."
  python3 "$repo_root/scripts/build_static_point_tiles.py" \
    --output "$catalog_tile_output" \
    --tile-url-base "$catalog_tile_public_base_url" \
    --version "$catalog_tile_version" \
    --skip-if-current
else
  echo "[catalog-import] Skipping static catalog point tiles. Set CATALOG_STATIC_TILES=1 to build them."
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
