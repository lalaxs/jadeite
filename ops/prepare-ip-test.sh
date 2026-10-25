#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export APP_VERSION="$(basename "$PWD")"
python3 - <<'PY'
from pathlib import Path
import os, secrets
config = Path('/opt/jade-market/.env.production')
if config.exists():
    text = config.read_text()
else:
    password = secrets.token_hex(32)
    text = Path('.env.production.example').read_text()
    text = text.replace('replace_with_a_long_random_hex_secret', password)
    text = text.replace('replace_with_a_separate_long_random_hex_secret', secrets.token_hex(32))
text = '\n'.join('APP_VERSION=' + os.environ['APP_VERSION'] if line.startswith('APP_VERSION=') else line
                 for line in text.splitlines()) + '\n'
config.write_text(text)
config.chmod(0o600)
PY
chown jadeops:jadeops /opt/jade-market/.env.production
rm -f .env.production
cp /opt/jade-market/.env.production .env.production
chown jadeops:jadeops .env.production
set -a
. ./.env.production
set +a
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --wait --wait-timeout 120 database
docker run --rm -v "$PWD:/app" -w /app node:24.20.0-bookworm-slim npm ci --ignore-scripts
docker compose --env-file .env.production exec -T database psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS jade_validation WITH (FORCE)' -c 'CREATE DATABASE jade_validation'
umask 077
printf 'TEST_DATABASE_URL=postgresql://%s:%s@database:5432/jade_validation\nLOAD_CLIENTS=10\nLOAD_SAVED_PLAYERS=100\nLOAD_INVENTORY_ITEMS=30\nLOAD_DURATION_MS=45000\nLOAD_REPORT_PATH=/app/.tmp/deploy-load.json\n' \
  "$POSTGRES_USER" "$POSTGRES_PASSWORD" > .env.validation
mkdir -p .tmp
docker run --rm --memory=2560m --cpus=2 --network jade-market_default --env-file .env.validation \
  -v "$PWD:/app" -w /app node:24.20.0-bookworm-slim npm run predeploy:postgres
docker compose --env-file .env.production exec -T database psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE jade_validation WITH (FORCE)'
rm .env.validation
touch .postgres-verified
sh ops/build-release.sh
printf 'Release %s prepared\n' "$APP_VERSION"
