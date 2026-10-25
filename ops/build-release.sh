#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./.env.production
docker compose --env-file .env.production build --pull
mkdir -p /opt/jade-market/static/releases dist/static
container_id=$(docker create "jade-market-web:$APP_VERSION")
docker cp "$container_id:/srv/releases/." /opt/jade-market/static/releases/
docker cp "$container_id:/srv/index.html" dist/static/index.html
docker rm "$container_id" >/dev/null
printf 'Release %s built\n' "$APP_VERSION"
