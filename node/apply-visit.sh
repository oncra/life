#!/bin/bash
# Put visits on a running node without a new image: a magnet on the visit contact (or the Witty Pi's button) starts
# one, and the clips leave over the visitor's phone hotspot or onto the Life Clips app on a laptop (life-visit.py).
#
#     sudo bash node/apply-visit.sh on            # visits on, started by the button (no visit contact fitted yet)
#     sudo bash node/apply-visit.sh on 22         # the same, with the visit contact on GPIO 22 (header pin 15)
#     sudo bash node/apply-visit.sh on 22 --install   # and install what a visit needs and the node lacks (see below)
#     sudo bash node/apply-visit.sh off           # visits off; the button is only the button again
#
# From a laptop with the repository: scp -r node clients life@<hostname>.local: and then, on the node,
# cd ~ && sudo bash node/apply-visit.sh on 22. Root is a read-only overlay, so this writes to the live root and to the
# one under it (/media/root-ro): the change takes effect now and holds after a reboot. It also brings the programs a
# visit works with up to date (life-clips, life-heartbeat, life-push, life-window, life-schedule) and has life-push
# hand the oracle's answer to life-visit and life-clips as well as life-guard.
#
# A visit needs ffmpeg (the clips' cut), nftables and dnsmasq (the node's own WiFi for a laptop). Without them the
# hotspot works and the node's own WiFi stays closed. --install puts the missing ones in the root under the overlay
# with apt, and only while the node's way out is its cable or its WiFi: never over the SIM. They count from the next
# boot. With visits on, a press of the Witty Pi's button outside the listening windows is a visit too, and the node
# powers off after it: to keep a node on for work, open a maintenance window on its page first.
set -euo pipefail
MODE=${1:?mode: on or off}
HERE=$(cd "$(dirname "$0")" && pwd)
ENVF=/data/life-node/env
LOWER=/media/root-ro
[ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }
[ -f "$ENVF" ] || { echo "no $ENVF: this is not a Life node"; exit 1; }

set_env() {
  if grep -q "^$1=" "$ENVF"; then sed -i "s#^$1=.*#$1=$2#" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi
}

case $MODE in
  off)
    set_env LIFE_VISIT 0
    systemctl stop life-visit-watch.service 2>/dev/null || true
    life-visit end 2>/dev/null || true
    echo "visits are off (LIFE_VISIT=0); the programs stay, apply-visit.sh on puts them back on"
    exit 0 ;;
  on) ;;
  *) echo "the mode is on or off"; exit 2 ;;
esac

PIN=""; INSTALL=0
for a in "${@:2}"; do
  case $a in
    --install) INSTALL=1 ;;
    [0-9]|[0-9][0-9]) PIN=$a ;;
    *) echo "unknown: $a (a BCM pin number, or --install)"; exit 2 ;;
  esac
done
for f in "$HERE/life-visit.py" "$HERE/life-visit@.service" "$HERE/life-visit-watch.service" "$HERE/life-clips.py" \
         "$HERE/life-clips.service" "$HERE/life-heartbeat.py" "$HERE/image/life-window.py" "$HERE/image/life-schedule.sh" \
         "$HERE/../clients/birdnet-pi-push.py"; do
  [ -f "$f" ] || { echo "missing $f: copy the repository's node/ and clients/ folders together"; exit 1; }
done

# what a visit needs that this node does not have (dnsmasq lives in /usr/sbin, on root's PATH)
NEED=()
command -v ffmpeg >/dev/null || NEED+=(ffmpeg)
command -v nft >/dev/null || NEED+=(nftables)
command -v dnsmasq >/dev/null || NEED+=(dnsmasq-base)
DEV=$(ip -o route get 1.1.1.1 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p')
if [ ${#NEED[@]} -gt 0 ] && [ $INSTALL = 1 ]; then
  case $DEV in
    eth0|wlan0) ;;
    *) echo "missing ${NEED[*]}, and the node's way out is ${DEV:-nothing}: install them on the cable or a WiFi, never over the SIM"; exit 1 ;;
  esac
fi

ROOTS=(/)
MOUNTED=()
cleanup() {
  local i
  for ((i=${#MOUNTED[@]}-1; i>=0; i--)); do umount "${MOUNTED[$i]}" 2>/dev/null || umount -l "${MOUNTED[$i]}" || true; done
  if mountpoint -q "$LOWER"; then mount -o remount,ro "$LOWER" || echo "could not make $LOWER read-only again: reboot"; fi
}
if mountpoint -q "$LOWER"; then
  mount -o remount,rw "$LOWER"
  trap cleanup EXIT
  ROOTS+=("$LOWER")
fi

if [ ${#NEED[@]} -gt 0 ] && [ $INSTALL = 1 ]; then
  echo "installing ${NEED[*]} over $DEV"
  if [ ${#ROOTS[@]} -gt 1 ]; then
    # apt in the root under the overlay, so the packages are there at the next boot; DNS as the live root has it
    for d in proc sys dev dev/pts run; do mount --bind "/$d" "$LOWER/$d" && MOUNTED+=("$LOWER/$d"); done
    if [ ! -L "$LOWER/etc/resolv.conf" ]; then
      touch "$LOWER/etc/resolv.conf" && mount --bind /etc/resolv.conf "$LOWER/etc/resolv.conf" && MOUNTED+=("$LOWER/etc/resolv.conf")
    fi
    chroot "$LOWER" apt-get update -qq
    DEBIAN_FRONTEND=noninteractive chroot "$LOWER" apt-get install -y -qq "${NEED[@]}" >/dev/null
    chroot "$LOWER" apt-get clean
    for c in ffmpeg nft dnsmasq; do chroot "$LOWER" sh -c "command -v $c" >/dev/null || { echo "$c did not install"; exit 1; }; done
  else
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${NEED[@]}" >/dev/null
  fi
fi

APPLY="/usr/local/bin/life-guard apply;/usr/local/bin/life-visit apply;/usr/local/bin/life-clips apply"
for R in "${ROOTS[@]}"; do
  S=$R/etc/systemd/system
  install -m 0755 "$HERE/life-visit.py" "$R/usr/local/bin/life-visit"
  install -m 0755 "$HERE/life-clips.py" "$R/usr/local/bin/life-clips"
  install -m 0755 "$HERE/life-heartbeat.py" "$R/usr/local/bin/life-heartbeat"
  install -m 0755 "$HERE/../clients/birdnet-pi-push.py" "$R/usr/local/bin/life-push"
  install -m 0755 "$HERE/image/life-window.py" "$R/usr/local/sbin/life-window"
  install -m 0755 "$HERE/image/life-schedule.sh" "$R/usr/local/sbin/life-schedule"
  install -m 0644 "$HERE/life-visit@.service" "$HERE/life-visit-watch.service" "$HERE/life-clips.service" "$S/"
  # the units' environment, as provision.sh writes it
  sed -i 's#^EnvironmentFile=.*#Environment=LIFE_CURSOR=/data/life-node/push-cursor BIRDNET_DB=/data/birdnet-go/birdnet.db "LIFE_HEARTBEAT_CMD=/usr/local/bin/life-heartbeat --json" "LIFE_HEARTBEAT_APPLY_CMD='"$APPLY"'" LIFE_STATE=/data/life-node LIFE_MIN_CONFIDENCE_FLOOR=0.7\nEnvironmentFile=/data/life-node/env#' \
    "$S/life-visit@.service" "$S/life-visit-watch.service" "$S/life-clips.service"
  # every other unit that hands the oracle's answer on: to life-visit and life-clips too
  for u in "$S"/life-*.service; do
    if grep -q '"LIFE_HEARTBEAT_APPLY_CMD=' "$u"; then sed -i 's#"LIFE_HEARTBEAT_APPLY_CMD=[^"]*"#"LIFE_HEARTBEAT_APPLY_CMD='"$APPLY"'"#' "$u"; fi
  done
  systemctl --root="$R" enable life-visit-watch.service >/dev/null
done

set_env LIFE_VISIT 1
if [ -n "$PIN" ]; then set_env LIFE_VISIT_PIN "$PIN"; fi
systemctl daemon-reload
systemctl restart life-visit-watch.service
set -a; . "$ENVF"; set +a
life-visit status
MISSING=()
for c in ffmpeg nft dnsmasq; do command -v $c >/dev/null || MISSING+=("$c"); done
if [ ${#NEED[@]} -gt 0 ] && [ $INSTALL = 1 ]; then
  echo "visits are on; ${NEED[*]} count from the next boot (until then the node's own WiFi stays closed)"
elif [ ${#MISSING[@]} -gt 0 ]; then
  echo "visits are on, but this node lacks ${MISSING[*]}: the hotspot works, the node's own WiFi stays closed. On the cable or a WiFi: apply-visit.sh on ${PIN:+$PIN }--install"
else
  echo "visits are on"
fi
