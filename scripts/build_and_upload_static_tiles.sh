#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_vars=(
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  CATALOG_TILE_VERSION
  CATALOG_TILE_PUBLIC_BASE_URL
  CATALOG_TILE_S3_BUCKET
  CATALOG_TILE_S3_ENDPOINT_URL
)

missing_vars=()
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    missing_vars+=("$var")
  fi
done
if [ -z "${CATALOG_TILE_S3_REGION:-${AWS_DEFAULT_REGION:-}}" ]; then
  missing_vars+=("CATALOG_TILE_S3_REGION")
fi

if [ "${#missing_vars[@]}" -ne 0 ]; then
  echo "[catalog-tiles] Missing required environment variables: ${missing_vars[*]}" >&2
  exit 1
fi

lock_file="${CATALOG_TILE_LOCK_FILE:-/tmp/starsmap-static-tiles.lock}"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "[catalog-tiles] Another static tile build is already running; exiting." >&2
  exit 1
fi

release_static_dir=""
if [ -d "$repo_root/lib" ]; then
  release_static_dir="$(find "$repo_root/lib" -maxdepth 3 -path '*/priv/static' -type d | head -n 1)"
fi

catalog_tile_version="$CATALOG_TILE_VERSION"
default_tile_output="$repo_root/backend_phoenix/priv/static/catalog-tiles/$catalog_tile_version"
if [ -n "$release_static_dir" ]; then
  default_tile_output="$release_static_dir/catalog-tiles/$catalog_tile_version"
elif [ -d "$repo_root/priv/static" ]; then
  default_tile_output="$repo_root/priv/static/catalog-tiles/$catalog_tile_version"
fi

catalog_tile_output="${CATALOG_TILE_OUTPUT_DIR:-$default_tile_output}"
catalog_tile_public_base_url="${CATALOG_TILE_PUBLIC_BASE_URL%/}"
catalog_tile_s3_prefix="${CATALOG_TILE_S3_PREFIX:-catalog-tiles/$catalog_tile_version}"
catalog_tile_s3_prefix="${catalog_tile_s3_prefix#/}"
catalog_tile_s3_prefix="${catalog_tile_s3_prefix%/}"
catalog_tile_s3_region="${CATALOG_TILE_S3_REGION:-${AWS_DEFAULT_REGION:-}}"
nice_level="${CATALOG_TILE_NICE:-15}"
aws_cmd="$repo_root/.venv/bin/aws"

if [ ! -x "$aws_cmd" ]; then
  aws_cmd="$(command -v aws || true)"
fi

if [ -z "$aws_cmd" ]; then
  echo "[catalog-tiles] aws CLI is not available in this container." >&2
  exit 1
fi

export AWS_DEFAULT_REGION="$catalog_tile_s3_region"
export AWS_EC2_METADATA_DISABLED=true

acl_args=()
if [ -n "${CATALOG_TILE_S3_ACL:-}" ]; then
  acl_args=(--acl "$CATALOG_TILE_S3_ACL")
fi

echo "[catalog-tiles] Building static point tiles at $catalog_tile_output"
echo "[catalog-tiles] Tile version: $catalog_tile_version"
echo "[catalog-tiles] Public tile base: $catalog_tile_public_base_url"
echo "[catalog-tiles] Upload target: s3://$CATALOG_TILE_S3_BUCKET/$catalog_tile_s3_prefix"
echo "[catalog-tiles] Using nice level $nice_level"

if ! existing_release_key="$("$aws_cmd" \
  --endpoint-url "$CATALOG_TILE_S3_ENDPOINT_URL" \
  s3api list-objects-v2 \
  --bucket "$CATALOG_TILE_S3_BUCKET" \
  --prefix "$catalog_tile_s3_prefix/" \
  --max-keys 1 \
  --query 'Contents[0].Key' \
  --output text)"; then
  echo "[catalog-tiles] Could not verify that immutable release $catalog_tile_version is unused; refusing to publish." >&2
  exit 1
fi
if [ -n "$existing_release_key" ] && [ "$existing_release_key" != "None" ] && [ "$existing_release_key" != "null" ]; then
  echo "[catalog-tiles] Refusing to overwrite immutable release $catalog_tile_version." >&2
  exit 1
fi

claim_file="$(mktemp)"
trap 'rm -f "$claim_file"' EXIT
printf 'catalog_version=%s\nclaimed_at=%s\n' "$catalog_tile_version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$claim_file"
claim_put_args=(
  --endpoint-url "$CATALOG_TILE_S3_ENDPOINT_URL"
  s3api put-object
  --bucket "$CATALOG_TILE_S3_BUCKET"
  --key "$catalog_tile_s3_prefix/.publishing"
  --body "$claim_file"
  --if-none-match "*"
  --cache-control "no-store"
  --content-type "text/plain"
)
if [ -n "${CATALOG_TILE_S3_ACL:-}" ]; then
  claim_put_args+=(--acl "$CATALOG_TILE_S3_ACL")
fi
if ! "$aws_cmd" "${claim_put_args[@]}" >/dev/null; then
  echo "[catalog-tiles] Another publisher claimed immutable release $catalog_tile_version; refusing to publish." >&2
  exit 1
fi

nice -n "$nice_level" \
  python3 "$repo_root/scripts/build_static_point_tiles.py" \
  --output "$catalog_tile_output" \
  --tile-url-base "$catalog_tile_public_base_url" \
  --version "$catalog_tile_version" \
  --skip-if-current

nice -n "$nice_level" "$aws_cmd" \
  --endpoint-url "$CATALOG_TILE_S3_ENDPOINT_URL" \
  s3 sync "$catalog_tile_output/" "s3://$CATALOG_TILE_S3_BUCKET/$catalog_tile_s3_prefix/" \
  --exclude "manifest.json" \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "application/octet-stream" \
  --only-show-errors \
  --no-progress \
  "${acl_args[@]}"

manifest_put_args=(
  --endpoint-url "$CATALOG_TILE_S3_ENDPOINT_URL"
  s3api put-object
  --bucket "$CATALOG_TILE_S3_BUCKET"
  --key "$catalog_tile_s3_prefix/manifest.json"
  --body "$catalog_tile_output/manifest.json"
  --if-none-match "*"
  --cache-control "public, max-age=60"
  --content-type "application/json"
)
if [ -n "${CATALOG_TILE_S3_ACL:-}" ]; then
  manifest_put_args+=(--acl "$CATALOG_TILE_S3_ACL")
fi

nice -n "$nice_level" "$aws_cmd" \
  "${manifest_put_args[@]}" \
  >/dev/null

echo "[catalog-tiles] Uploaded manifest: $catalog_tile_public_base_url/manifest.json"
