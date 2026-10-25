#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test -f .postgres-verified
ln -sfn "$PWD" /opt/jade-market/current
docker stop jade-acme
docker rm jade-acme
pkill -f '^python3 /tmp/jade-upload.py$' || true
docker compose --env-file .env.production up -d --wait --wait-timeout 180
install -m 644 dist/static/index.html /opt/jade-market/static/index.html.next
mv /opt/jade-market/static/index.html.next /opt/jade-market/static/index.html
install -m 644 ops/renew-ip-certificate.service /etc/systemd/system/
install -m 644 ops/renew-ip-certificate.timer /etc/systemd/system/
install -m 755 ops/reload-certificate.sh /etc/letsencrypt/renewal-hooks/deploy/jade-market
systemctl daemon-reload
systemctl enable --now renew-ip-certificate.timer
/opt/certbot/bin/certbot renew --dry-run --run-deploy-hooks
rm -f /tmp/jade-upload.py
docker compose --env-file .env.production ps
