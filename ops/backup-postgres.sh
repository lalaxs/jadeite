#!/bin/sh
set -eu

backup_dir=/backups
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${backup_dir}/jade-market-${timestamp}.dump"
temporary="${target}.tmp"

mkdir -p "${backup_dir}"
pg_dump --format=custom --compress=9 --file="${temporary}"
pg_restore --list "${temporary}" >/dev/null
mv "${temporary}" "${target}"
sha256sum "${target}" > "${target}.sha256"
find "${backup_dir}" -type f -name 'jade-market-*.dump' -mtime "+${retention_days}" -delete
find "${backup_dir}" -type f -name 'jade-market-*.dump.sha256' -mtime "+${retention_days}" -delete
echo "backup created: ${target}"

