#!/usr/bin/env bash
# Deploy or update the Life Oracle on a host that has Docker + git. Idempotent.
#   ssh admin@HOST 'bash -s' < deploy/deploy.sh
set -euo pipefail
DIR=/opt/life
if [ ! -d "$DIR/.git" ]; then sudo mkdir -p "$DIR" && sudo chown "$USER" "$DIR" && git clone https://github.com/oncra/life.git "$DIR"; fi
cd "$DIR"
git fetch --quiet origin main && git reset --quiet --hard origin/main
[ -f .env ] || { cp deploy/env.example .env; echo "Edit $DIR/.env first (POSTGRES_PASSWORD, ADMIN_API_KEY, SITE_HOST)"; exit 1; }
docker compose build --pull app
docker compose up -d --remove-orphans
# the build cache grows by a few hundred MB per deploy and once filled the disk (12 October 2026); keep the recent layers only
docker builder prune -f --keep-storage 3G >/dev/null 2>&1 || true
docker compose ps
