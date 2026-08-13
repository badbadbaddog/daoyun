#!/usr/bin/env bash
set -euo pipefail

database_url="${DATABASE_URL:-}"
output_directory="${1:-backups/postgres}"

if [[ -z "$database_url" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 2
fi
command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump was not found on PATH." >&2
  exit 127
}

mkdir -p "$output_directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$output_directory/daoyun-$timestamp.dump"

if ! pg_dump \
  --dbname="$database_url" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$backup_path"; then
  rm -f -- "$backup_path"
  exit 1
fi

sha256sum "$backup_path" > "$backup_path.sha256"
printf '%s\n' "$backup_path"
