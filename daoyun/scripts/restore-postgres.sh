#!/usr/bin/env bash
set -euo pipefail

backup_file="${1:-}"
database_url="${DATABASE_URL:-}"

if [[ -z "$backup_file" || -z "$database_url" ]]; then
  echo "Usage: DATABASE_URL=... $0 BACKUP_FILE" >&2
  exit 2
fi
if [[ "${ALLOW_DATA_LOSS:-}" != "1" ]]; then
  echo "Set ALLOW_DATA_LOSS=1 after verifying the target database." >&2
  exit 2
fi
command -v pg_restore >/dev/null 2>&1 || {
  echo "pg_restore was not found on PATH." >&2
  exit 127
}
[[ -f "$backup_file" ]] || {
  echo "Backup file was not found: $backup_file" >&2
  exit 1
}

if [[ -f "$backup_file.sha256" ]]; then
  sha256sum --check "$backup_file.sha256"
fi

pg_restore \
  --dbname="$database_url" \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --single-transaction \
  "$backup_file"
