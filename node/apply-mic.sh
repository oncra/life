#!/bin/bash
# Put life-mic on a running node without a new image, and choose how the node listens:
#
#     sudo bash node/apply-mic.sh both        # the comparison: birds on the I2S microphone and on the AudioMoth
#     sudo bash node/apply-mic.sh audiomoth   # the AudioMoth as the node's one microphone
#     sudo bash node/apply-mic.sh i2s         # birds on the I2S microphone, the AudioMoth for bats only
#
# From a laptop with the repository: scp -r node clients life@<hostname>.local: and then, on the node,
# cd ~ && sudo bash node/apply-mic.sh both. Root is a read-only overlay, so this writes to the live root and to the
# one under it (/media/root-ro): the change takes effect now and holds after a reboot. It replaces life-bats and its
# unit where a node has them. Mode both also sets LIFE_TEST_SOURCES=AudioMoth, so life-push sends the AudioMoth's
# bird detections as test while the two microphones are compared; the other modes take that out again.
set -euo pipefail
MODE=${1:?mode: i2s, audiomoth or both}
case $MODE in i2s|audiomoth|both) ;; *) echo "the mode is i2s, audiomoth or both"; exit 2 ;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
ENVF=/data/life-node/env
[ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }
[ -f "$ENVF" ] || { echo "no $ENVF: this is not a Life node"; exit 1; }
for f in "$HERE/life-mic.py" "$HERE/life-mic-setup.service" "$HERE/life-mic-sync.service" "$HERE/life-mic.timer" \
         "$HERE/../clients/birdnet-pi-push.py"; do
  [ -f "$f" ] || { echo "missing $f: copy the repository's node/ and clients/ folders together"; exit 1; }
done

LOWER=/media/root-ro
ROOTS=(/)
if mountpoint -q "$LOWER"; then
  mount -o remount,rw "$LOWER"
  trap 'mount -o remount,ro '"$LOWER"' || echo "could not make '"$LOWER"' read-only again: reboot"' EXIT
  ROOTS+=("$LOWER")
fi

for R in "${ROOTS[@]}"; do
  install -m 0755 "$HERE/life-mic.py" "$R/usr/local/bin/life-mic"
  install -m 0755 "$HERE/../clients/birdnet-pi-push.py" "$R/usr/local/bin/life-push"
  for u in life-mic-setup.service life-mic-sync.service life-mic.timer; do
    install -m 0644 "$HERE/$u" "$R/etc/systemd/system/$u"
  done
  sed -i 's#^EnvironmentFile=.*#EnvironmentFile=/data/life-node/env#' \
    "$R/etc/systemd/system/life-mic-setup.service" "$R/etc/systemd/system/life-mic-sync.service"
  # life-bats goes: its unit would write the old bat source back at every boot
  systemctl --root="$R" disable life-bats-setup.service >/dev/null 2>&1 || true
  rm -f "$R/etc/systemd/system/life-bats-setup.service" "$R/usr/local/bin/life-bats"
  systemctl --root="$R" enable life-mic-setup.service life-mic.timer >/dev/null
done

set_env() {
  if grep -q "^$1=" "$ENVF"; then sed -i "s#^$1=.*#$1=$2#" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi
}
set_env LIFE_BIRD_MIC "$MODE"
if [ "$MODE" = both ]; then set_env LIFE_TEST_SOURCES AudioMoth; else sed -i '/^LIFE_TEST_SOURCES=/d' "$ENVF"; fi

systemctl daemon-reload
systemctl stop birdnet-go.service
systemctl start life-mic-setup.service
systemctl start birdnet-go.service life-mic.timer
set -a; . "$ENVF"; set +a
life-mic status
echo "life-mic is on in mode $MODE; BirdNET-Go restarted"
