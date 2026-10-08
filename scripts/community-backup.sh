#!/usr/bin/env bash
# Schedule daily in the worker. Recovery uses a different, empty database.
set -Eeuo pipefail
umask 077
mode="${1:-backup}"
backup_path="${2:-}"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
: "${COMMUNITY_BACKUP_SECRET:?Set the independent backup encryption secret}"

if [[ "$mode" == "backup" ]]; then
  : "${COMMUNITY_DATABASE_URL:?Set the community database URL}"
  pg_dump --format=custom --no-owner --no-acl --file="$scratch/community.dump" "$COMMUNITY_DATABASE_URL"
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 --output "$scratch/community.dump.gpg" "$scratch/community.dump" 3<<<"$COMMUNITY_BACKUP_SECRET"
  if [[ -n "$backup_path" ]]; then
    cp "$scratch/community.dump.gpg" "$backup_path"
  else
    : "${COMMUNITY_BACKUP_URI:?Set the off-host s3:// backup destination}"
    : "${COMMUNITY_BACKUP_ACCESS_KEY_ID:?Use separate backup credentials}"
    : "${COMMUNITY_BACKUP_SECRET_ACCESS_KEY:?Use separate backup credentials}"
    export AWS_ACCESS_KEY_ID="$COMMUNITY_BACKUP_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$COMMUNITY_BACKUP_SECRET_ACCESS_KEY"
    export AWS_DEFAULT_REGION="${COMMUNITY_BACKUP_REGION:-us-east-1}"
    aws_args=()
    [[ -z "${COMMUNITY_BACKUP_ENDPOINT:-}" ]] || aws_args+=(--endpoint-url "$COMMUNITY_BACKUP_ENDPOINT")
    /app/.venv/bin/aws "${aws_args[@]}" s3 cp "$scratch/community.dump.gpg" "${COMMUNITY_BACKUP_URI%/}/$(date -u +%Y%m%dT%H%M%SZ).dump.gpg" --only-show-errors
  fi
elif [[ "$mode" == "restore-test" ]]; then
  : "${COMMUNITY_RESTORE_TEST_URL:?Set a separate, empty recovery database}"
  [[ -n "$backup_path" && -f "$backup_path" ]] || { echo 'Supply the encrypted backup file' >&2; exit 1; }
  [[ "$COMMUNITY_RESTORE_TEST_URL" != "${COMMUNITY_DATABASE_URL:-}" ]] || { echo 'Recovery must use a separate database' >&2; exit 1; }
  existing="$(psql "$COMMUNITY_RESTORE_TEST_URL" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  [[ "$existing" == "0" ]] || { echo 'Recovery database must be empty' >&2; exit 1; }
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$scratch/community.dump" "$backup_path" 3<<<"$COMMUNITY_BACKUP_SECRET"
  pg_restore --exit-on-error --no-owner --no-acl --dbname="$COMMUNITY_RESTORE_TEST_URL" "$scratch/community.dump"
  psql "$COMMUNITY_RESTORE_TEST_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT 'photos=' || count(*) FROM photos; SELECT 'votes=' || count(*) FROM photo_votes; SELECT 'subjects=' || count(*) FROM subjects; SELECT version FROM schema_migrations ORDER BY version;"
else
  echo 'Use backup [output.gpg] or restore-test input.gpg' >&2
  exit 1
fi
