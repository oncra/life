#!/bin/bash
# Let a running node take its settings from the oracle over the air, without a new image (life-config.py): its
# listening windows and a short list of its own settings, sent with the oracle's answer to a heartbeat when they
# change. Once per node, on the bench or at a visit; after that a change of settings needs nobody at the node.
#
#     sudo bash node/apply-config.sh
#
# From a laptop with the repository: scp -r node clients life@<hostname>.local: and then, on the node,
# cd ~ && sudo bash node/apply-config.sh. Root is a read-only overlay, so this writes to the live root and to the one
# under it (/media/root-ro): the change takes effect now and holds after a reboot. It brings the programs that read or
# report the settings up to date (life-schedule-wpi, life-schedule, life-window, life-heartbeat, life-push, and
# life-clips where the node has it), which puts the night window for meadow birds on the node as well, and has life-push
# hand the oracle's answer to life-window and life-config too. Nothing changes until the oracle sends settings: until
# then the node keeps its built-in windows and its own env file.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ENVF=/data/life-node/env
LOWER=/media/root-ro
[ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }
[ -f "$ENVF" ] || { echo "no $ENVF: this is not a Life node"; exit 1; }
for f in life-config.py life-heartbeat.py life-clips.py image/life-schedule-wpi.py image/life-schedule.sh image/life-window.py ../clients/birdnet-pi-push.py; do
  [ -f "$HERE/$f" ] || { echo "missing $HERE/$f: copy the repository's node/ and clients/ folders together"; exit 1; }
done
# the windows are read by the same program at every step; it must run here before anything is replaced
LIFE_CONFIG=/nonexistent python3 "$HERE/image/life-schedule-wpi.py" --windows >/dev/null \
  || { echo "life-schedule-wpi does not run on this node (python3-astral?); nothing changed"; exit 1; }

ROOTS=(/)
cleanup() { if mountpoint -q "$LOWER"; then mount -o remount,ro "$LOWER" || echo "could not make $LOWER read-only again: reboot"; fi; }
if mountpoint -q "$LOWER"; then
  mount -o remount,rw "$LOWER"
  trap cleanup EXIT
  ROOTS+=("$LOWER")
fi

CLIPS=0; [ -e /usr/local/bin/life-clips ] && CLIPS=1
for R in "${ROOTS[@]}"; do
  install -m 0755 "$HERE/life-config.py" "$R/usr/local/bin/life-config"
  install -m 0755 "$HERE/life-heartbeat.py" "$R/usr/local/bin/life-heartbeat"
  install -m 0755 "$HERE/../clients/birdnet-pi-push.py" "$R/usr/local/bin/life-push"
  install -m 0755 "$HERE/image/life-schedule-wpi.py" "$R/usr/local/sbin/life-schedule-wpi"
  install -m 0755 "$HERE/image/life-schedule.sh" "$R/usr/local/sbin/life-schedule"
  install -m 0755 "$HERE/image/life-window.py" "$R/usr/local/sbin/life-window"
  if [ $CLIPS = 1 ]; then install -m 0755 "$HERE/life-clips.py" "$R/usr/local/bin/life-clips"; fi
  # the oracle's answer goes to every program on this node that takes a part of it, life-config last
  APPLY=""
  for p in bin/life-guard bin/life-visit bin/life-clips sbin/life-window bin/life-config; do
    if [ -e "$R/usr/local/$p" ]; then APPLY="${APPLY:+$APPLY;}/usr/local/$p apply"; fi
  done
  for u in "$R"/etc/systemd/system/life-*.service; do
    [ -f "$u" ] || continue
    if grep -q '"LIFE_HEARTBEAT_APPLY_CMD=' "$u"; then
      sed -i 's#"LIFE_HEARTBEAT_APPLY_CMD=[^"]*"#"LIFE_HEARTBEAT_APPLY_CMD='"$APPLY"'"#' "$u"
    elif grep -q '"LIFE_HEARTBEAT_CMD=' "$u"; then
      # a node from before the oracle answered anything: the answer goes nowhere yet
      sed -i 's#"LIFE_HEARTBEAT_CMD=\([^"]*\)"#"LIFE_HEARTBEAT_CMD=\1" "LIFE_HEARTBEAT_APPLY_CMD='"$APPLY"'"#' "$u"
    fi
  done
done
systemctl daemon-reload
grep -l 'life-config apply' /etc/systemd/system/life-sound.service >/dev/null 2>&1 \
  || echo "WARNING life-sound.service does not hand the oracle's answer to life-config; see its Environment line"
life-config status
echo "settings over the air are on: the node reports them from its next post, and takes what the oracle sends"
