#!/usr/bin/env bash
# Deploy or update the life oracle on a host that has Docker + git. Idempotent.
#   ssh admin@HOST 'bash -s' < deploy/deploy.sh
set -euo pipefail
DIR=/opt/life
if [ ! -d "$DIR/.git" ]; then sudo mkdir -p "$DIR" && sudo chown "$USER" "$DIR" && git clone https://github.com/oncra/life.git "$DIR"; fi
cd "$DIR"
git fetch --quiet origin main && git reset --quiet --hard origin/main
[ -f .env ] || { cp deploy/env.example .env; echo "Edit $DIR/.env first (POSTGRES_PASSWORD, ADMIN_API_KEY, SITE_HOST)"; exit 1; }
docker compose build --pull app
docker compose up -d --remove-orphans
docker compose ps
