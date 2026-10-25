#!/bin/sh
set -eu
cd /opt/jade-market/current
docker compose --env-file .env.production exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force
