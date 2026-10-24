#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: restore-postgres.sh /backups/jade-market-YYYYMMDDTHHMMSSZ.dump" >&2
  exit 2
fi

backup="$1"
test -f "${backup}"
test -f "${backup}.sha256"
(cd "$(dirname "${backup}")" && sha256sum -c "$(basename "${backup}").sha256")
pg_restore --list "${backup}" >/dev/null
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${PGDATABASE}" "${backup}"
echo "restore completed: ${backup}"

