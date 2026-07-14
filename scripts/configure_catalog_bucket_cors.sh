#!/usr/bin/env bash
set -euo pipefail

: "${CATALOG_TILE_S3_BUCKET:?CATALOG_TILE_S3_BUCKET is required}"
: "${CATALOG_TILE_S3_ENDPOINT_URL:?CATALOG_TILE_S3_ENDPOINT_URL is required}"

aws_cmd="${AWS_CLI:-}"
if [ -z "$aws_cmd" ] && [ -x .venv/bin/aws ]; then aws_cmd=.venv/bin/aws; fi
if [ -z "$aws_cmd" ]; then aws_cmd="$(command -v aws)"; fi

cors_file="$(mktemp)"
trap 'rm -f "$cors_file"' EXIT
cat >"$cors_file" <<'JSON'
{
  "CORSRules": [
    {
      "AllowedHeaders": ["Range", "If-None-Match", "If-Modified-Since"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"],
      "MaxAgeSeconds": 86400
    }
  ]
}
JSON

"$aws_cmd" --endpoint-url "$CATALOG_TILE_S3_ENDPOINT_URL" s3api put-bucket-cors \
  --bucket "$CATALOG_TILE_S3_BUCKET" \
  --cors-configuration "file://$cors_file"

"$aws_cmd" --endpoint-url "$CATALOG_TILE_S3_ENDPOINT_URL" s3api get-bucket-cors \
  --bucket "$CATALOG_TILE_S3_BUCKET"
