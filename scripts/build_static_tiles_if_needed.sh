#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_static_dir=""

if [ -d "$repo_root/lib" ]; then
  release_static_dir="$(find "$repo_root/lib" -maxdepth 3 -path '*/priv/static' -type d | head -n 1)"
fi

default_tile_output="$repo_root/backend_phoenix/priv/static/catalog-tiles/v1"
if [ -n "$release_static_dir" ]; then
  default_tile_output="$release_static_dir/catalog-tiles/v1"
elif [ -d "$repo_root/priv/static" ]; then
  default_tile_output="$repo_root/priv/static/catalog-tiles/v1"
fi

catalog_tile_output="${CATALOG_TILE_OUTPUT_DIR:-$default_tile_output}"
nice_level="${CATALOG_TILE_NICE:-15}"
tile_url_base="${CATALOG_TILE_PUBLIC_BASE_URL:-/catalog-tiles/v1}"

echo "[catalog-tiles] Building static point tiles at $catalog_tile_output"
echo "[catalog-tiles] Using nice level $nice_level"

exec nice -n "$nice_level" \
  python3 "$repo_root/scripts/build_static_point_tiles.py" \
  --output "$catalog_tile_output" \
  --tile-url-base "$tile_url_base" \
  --skip-if-current
