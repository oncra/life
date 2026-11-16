#!/usr/bin/env bash
# The research archive's copy, run on the oracle host as root once a night (deploy/clip-archive.timer). The worker
# container says which clip files are worth keeping (scripts/clip-archive.ts); this copies them with rsync over SSH to
# the archive, records what arrived, judges the clips below the line, and puts the CSV per place and month beside the
# sound. The oracle deletes a clip's sound only once one of these two happened (src/lib/clips.ts, pruneClips), so a
# night this fails costs disk, never a clip. Settings in /opt/life/.env:
#   CLIP_ARCHIVE=1                         on (the app and worker read it too)
#   CLIP_ARCHIVE_TARGET=user@host:clips    where the archive lives (a directory the SSH user may write)
#   CLIP_ARCHIVE_SSH="ssh -i KEY -p 23"    how to reach it (a Hetzner Storage Box listens on 23)
set -euo pipefail
DIR=/opt/life
cd "$DIR"
env_of() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
[ "$(env_of CLIP_ARCHIVE)" = 1 ] || { echo "CLIP_ARCHIVE is not 1: nothing to do"; exit 0; }
TARGET=$(env_of CLIP_ARCHIVE_TARGET); SSH=$(env_of CLIP_ARCHIVE_SSH)
[ -n "$TARGET" ] && [ -n "$SSH" ] || { echo "CLIP_ARCHIVE_TARGET and CLIP_ARCHIVE_SSH must be set" >&2; exit 1; }
HOST=${TARGET%%:*}; RDIR=${TARGET#*:}
beat() { [ -x /usr/local/bin/backup-heartbeat.sh ] && /usr/local/bin/backup-heartbeat.sh life-clip-archive "$1" || true; }
trap 'beat error' ERR

run() { docker compose exec -T worker npx tsx scripts/clip-archive.ts "$@"; }
LIST=$(mktemp); trap 'rm -f "$LIST"' EXIT

$SSH "$HOST" mkdir -p "$RDIR" "$RDIR/manifest" >/dev/null
run pending > "$LIST"
if [ -s "$LIST" ]; then
  # names carry the first half of each file's SHA-256, so a file once there never changes: --ignore-existing
  rsync -a --ignore-existing --files-from="$LIST" -e "$SSH" images/clips/ "$HOST:$RDIR/"
  run done < "$LIST"
fi
run skip
# the manifests of every month that got clips in the last two days (so a night that failed here is made good the
# next); written inside the container under /images, read here
rm -rf images/clip-manifest
run manifest /images/clip-manifest >/dev/null
[ -d images/clip-manifest ] && rsync -a -e "$SSH" images/clip-manifest/ "$HOST:$RDIR/manifest/"
rm -rf images/clip-manifest
echo "copied $(wc -l < "$LIST") files; $(run status)"
beat ok
