#!/bin/bash
# Make a node on the bench reachable from anywhere over Tailscale, without a new image. How it works, and why the SIM
# never carries it: life-tailscale.py.
#
#     sudo bash node/apply-tailscale.sh on tailscale_1.104.4_arm64.tgz   # put it on (or update it) and switch it on
#     sudo bash node/apply-tailscale.sh off                               # off for now; the node stays in the tailnet
#     sudo bash node/apply-tailscale.sh forget                            # before the node goes to a field
#
# Fetch Tailscale's static build on a laptop, never on the node over 4G, and compare it with the published checksum:
#     curl -fLO https://pkgs.tailscale.com/stable/tailscale_1.104.4_arm64.tgz
#     curl -fsS https://pkgs.tailscale.com/stable/tailscale_1.104.4_arm64.tgz.sha256; shasum -a 256 tailscale_1.104.4_arm64.tgz
#     scp -r node tailscale_1.104.4_arm64.tgz life@<hostname>.local:
# and then, on the node, cd ~ && sudo bash node/apply-tailscale.sh on tailscale_1.104.4_arm64.tgz. Joining the steward's
# tailnet is once per node: sudo tailscale up --hostname=<hostname> --accept-dns=false prints a link, and the steward opens
# it and logs in. The identity stays on /data, so off and on again needs no new login; forget logs the node out and
# deletes that identity, so a node stolen from a field cannot rejoin the tailnet. Root is a read-only overlay, so
# this writes to the live root and to the one under it (/media/root-ro): the change takes effect now and holds after a
# reboot.
set -euo pipefail
MODE=${1:?mode: on, off or forget}
HERE=$(cd "$(dirname "$0")" && pwd)
ENVF=/data/life-node/env
TS=/data/tailscale
[ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }
[ -f "$ENVF" ] || { echo "no $ENVF: this is not a Life node"; exit 1; }

set_env() {
  if grep -q "^$1=" "$ENVF"; then sed -i "s#^$1=.*#$1=$2#" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi
}

case $MODE in
  forget)
    tailscale logout 2>/dev/null || echo "could not log out (no tailscaled running): remove the node in the Tailscale admin console too"
    systemctl stop life-tailscale.service 2>/dev/null || true
    rm -rf "$TS/state"
    set_env LIFE_TAILSCALE 0
    echo "Tailscale is off and the node's identity is gone; on the bench again, apply-tailscale.sh on and a new login"
    exit 0 ;;
  off)
    set_env LIFE_TAILSCALE 0
    systemctl stop life-tailscale.service 2>/dev/null || true
    echo "Tailscale is off (LIFE_TAILSCALE=0); the node's identity stays in $TS for its next time on the bench"
    exit 0 ;;
  on) ;;
  *) echo "the mode is on, off or forget"; exit 2 ;;
esac

TGZ=${2:?the Tailscale build, tailscale_<version>_arm64.tgz, fetched on a laptop}
case $(uname -m) in aarch64) ARCH=arm64 ;; armv7l|armv6l) ARCH=arm ;; *) ARCH=$(uname -m) ;; esac
case $(basename "$TGZ") in *_"$ARCH".tgz) ;; *) echo "$TGZ is not the $ARCH build this Pi needs"; exit 1 ;; esac
for f in "$HERE/life-tailscale.py" "$HERE/life-tailscale.service"; do
  [ -f "$f" ] || { echo "missing $f: copy the repository's node/ folder"; exit 1; }
done
echo "sha256 $(sha256sum "$TGZ" | cut -d' ' -f1)  $(basename "$TGZ")  (the published .sha256 should say the same)"

NEW=$(mktemp -d /data/tailscale-new.XXXX)
tar -xzf "$TGZ" -C "$NEW" --strip-components=1 --wildcards '*/tailscale' '*/tailscaled'
"$NEW/tailscaled" --version >/dev/null   # it runs on this Pi
systemctl stop life-tailscale.service 2>/dev/null || true
mkdir -p "$TS/state" && chmod 700 "$TS/state"
install -m 0755 "$NEW/tailscale" "$NEW/tailscaled" "$TS/"
rm -rf "$NEW"

LOWER=/media/root-ro
ROOTS=(/)
if mountpoint -q "$LOWER"; then
  mount -o remount,rw "$LOWER"
  trap 'mount -o remount,ro '"$LOWER"' || echo "could not make '"$LOWER"' read-only again: reboot"' EXIT
  ROOTS+=("$LOWER")
fi
for R in "${ROOTS[@]}"; do
  install -m 0755 "$HERE/life-tailscale.py" "$R/usr/local/bin/life-tailscale"
  ln -sfn "$TS/tailscale" "$R/usr/local/bin/tailscale"
  install -m 0644 "$HERE/life-tailscale.service" "$R/etc/systemd/system/life-tailscale.service"
  sed -i 's#^EnvironmentFile=.*#EnvironmentFile=/data/life-node/env#' "$R/etc/systemd/system/life-tailscale.service"
  systemctl --root="$R" enable life-tailscale.service >/dev/null
done

set_env LIFE_TAILSCALE 1
systemctl daemon-reload
systemctl restart life-tailscale.service
sleep 5
life-tailscale status
echo "Tailscale is on. Once per node: sudo tailscale up --hostname=$(hostname) --accept-dns=false, then open the link it prints"
