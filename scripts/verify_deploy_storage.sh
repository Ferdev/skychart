#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"

minimum_free_gib="${MINIMUM_DEPLOY_FREE_GIB:-6}"
if ! [[ "$minimum_free_gib" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::MINIMUM_DEPLOY_FREE_GIB must be a positive integer" >&2
  exit 1
fi

storage_report="$({
  ssh -x -T "$DEPLOY_HOST" '
    set -eu
    docker_root=$(docker info --format "{{.DockerRootDir}}")
    root_available_kib=$(df -Pk / | awk "NR == 2 { print \$4 }")
    docker_available_kib=$(df -Pk "$docker_root" | awk "NR == 2 { print \$4 }")
    printf "SKYCHART_STORAGE|%s|%s|%s\n" "$root_available_kib" "$docker_available_kib" "$docker_root"
  '
} | awk -F '|' '$1 == "SKYCHART_STORAGE" { line = $0 } END { print line }')"

IFS='|' read -r marker root_available_kib docker_available_kib docker_root <<< "$storage_report"
if [[ "$marker" != "SKYCHART_STORAGE" ]] ||
  ! [[ "$root_available_kib" =~ ^[0-9]+$ ]] ||
  ! [[ "$docker_available_kib" =~ ^[0-9]+$ ]] ||
  [[ -z "$docker_root" ]]; then
  echo "::error::Could not read root and Docker storage headroom from $DEPLOY_HOST" >&2
  exit 1
fi

minimum_free_kib=$((minimum_free_gib * 1024 * 1024))
root_available_gib=$((root_available_kib / 1024 / 1024))
docker_available_gib=$((docker_available_kib / 1024 / 1024))

if (( root_available_kib < minimum_free_kib )); then
  echo "::error::Insufficient root filesystem space for staging deploy: ${root_available_gib} GiB free, ${minimum_free_gib} GiB required" >&2
  exit 1
fi

if (( docker_available_kib < minimum_free_kib )); then
  echo "::error::Insufficient Docker storage space at ${docker_root}: ${docker_available_gib} GiB free, ${minimum_free_gib} GiB required" >&2
  exit 1
fi

echo "Storage headroom OK: root ${root_available_gib} GiB free; Docker (${docker_root}) ${docker_available_gib} GiB free"
