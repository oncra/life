#!/bin/bash
# Life node: runs early on every boot, before the network. Idempotent.
# The root filesystem is a read-only overlay (overlayroot=tmpfs); everything that must survive a reboot
# lives on the third partition, mounted at /data. This script keeps that partition in shape and moves
# per-node settings from the boot partition (which any laptop can write) onto it.
set -u
DATA=/data
BOOT=/boot/firmware
DEV=$(findmnt -no SOURCE $DATA)                  # /dev/mmcblk0p3 on an SD card, /dev/sda3 on USB
DISK=${DEV%p3}; DISK=${DISK%3}
log() { echo "life-firstboot: $*"; }

# 1. grow the data partition to the end of the card, once
if [ ! -e $DATA/.grown ] && [ -b "$DEV" ]; then
  growpart "$DISK" 3 && resize2fs "$DEV" && touch $DATA/.grown && log "data partition grown to fill the card"
fi

# 2. per-node settings dropped on the boot partition move to /data (and out of the boot partition)
mkdir -p $DATA/life-node $DATA/birdnet-go $DATA/wittypi $DATA/nm-connections $DATA/ssh $DATA/log/journal
if [ -f $BOOT/life-node.env ]; then
  install -m 0600 $BOOT/life-node.env $DATA/life-node/env && rm -f $BOOT/life-node.env && sync && log "took life-node.env from the boot partition"
fi
[ -f $DATA/life-node/env ] || { install -m 0600 /usr/share/life-node/life-node.env.example $DATA/life-node/env; log "no life-node.env yet: using the example, nothing will be posted"; }
# systemd reads this file as an EnvironmentFile, which keeps a trailing "# comment" as part of the value
# (LIFE_POST_BATCH="3   # post once..."), so strip those from unquoted values; quoted values are left alone
sed -i -E '/^[A-Z0-9_]+=[^"'"'"']/ s/[[:space:]]+#.*$//' $DATA/life-node/env
set -a; . $DATA/life-node/env; set +a

# 3. hostname (root is tmpfs, so this is redone every boot; cheap)
H=${NODE_HOSTNAME:-life-node}
hostname "$H"; echo "$H" > /etc/hostname; sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$H/" /etc/hosts; grep -q '^127.0.1.1' /etc/hosts || echo -e "127.0.1.1\t$H" >> /etc/hosts

# 3b. the login. Root is a tmpfs overlay, so the password and the SSH key are re-applied at every boot from
# the env file: NODE_PASSWORD replaces the image's default password ("lifebox"), NODE_SSH_KEY is one public key.
if [ -n "${NODE_PASSWORD:-}" ]; then echo "life:${NODE_PASSWORD}" | chpasswd && log "password set from the env file"; fi
if [ -n "${NODE_SSH_KEY:-}" ]; then
  install -d -m 0700 -o life -g life /home/life/.ssh && printf '%s\n' "$NODE_SSH_KEY" > /home/life/.ssh/authorized_keys && chown life:life /home/life/.ssh/authorized_keys && chmod 0600 /home/life/.ssh/authorized_keys
fi

# 3c. clock and radio. Root is tmpfs, so both are set every boot. The schedule runs on local clock time;
# the stock Raspberry Pi OS root ships NetworkManager with WirelessEnabled=false, so wlan0 stays "unavailable" even
# with a connection written; this runs before NetworkManager, so turning the radio on here holds for this boot.
ln -sf /usr/share/zoneinfo/${NODE_TZ:-Europe/Amsterdam} /etc/localtime; echo "${NODE_TZ:-Europe/Amsterdam}" > /etc/timezone
iw reg set "${WIFI_COUNTRY:-NL}" 2>/dev/null || true
if [ -n "${WIFI_SSID:-}" ]; then
  mkdir -p /var/lib/NetworkManager && printf '[main]\nNetworkingEnabled=true\nWirelessEnabled=true\nWWANEnabled=true\n' > /var/lib/NetworkManager/NetworkManager.state
fi

# 4. ssh host keys: generated once, kept on /data (sshd_config points there)
for t in ed25519 rsa; do
  [ -f $DATA/ssh/ssh_host_${t}_key ] || ssh-keygen -q -N "" -t $t -f $DATA/ssh/ssh_host_${t}_key
done
chmod 600 $DATA/ssh/ssh_host_*_key

# 5. bench WiFi, if the env names one and no connection exists yet (the field node has no WiFi to join)
if [ -n "${WIFI_SSID:-}" ] && [ ! -f "$DATA/nm-connections/bench-wifi.nmconnection" ]; then
  cat > "$DATA/nm-connections/bench-wifi.nmconnection" <<NM
[connection]
id=bench-wifi
type=wifi
autoconnect=true
[wifi]
mode=infrastructure
ssid=$WIFI_SSID
[wifi-security]
key-mgmt=wpa-psk
psk=${WIFI_PSK:-}
[ipv4]
method=auto
[ipv6]
method=auto
NM
  chmod 600 "$DATA/nm-connections/bench-wifi.nmconnection"; log "wrote bench WiFi connection for $WIFI_SSID"
fi

# 6. BirdNET-Go: the place's coordinates from the env file, for the species range filter
if [ -n "${NODE_LAT:-}" ] && [ -f $DATA/birdnet-go/config.yaml ]; then
  sed -i "s/^    latitude: .*/    latitude: $NODE_LAT/; s/^    longitude: .*/    longitude: ${NODE_LON:-0}/" $DATA/birdnet-go/config.yaml
fi

# 7. Witty Pi: its scripts live on /data so the schedule and logs persist; seed them from the image once
if [ ! -f $DATA/wittypi/wittyPi.sh ]; then
  cp -r /usr/share/life-node/wittypi/. $DATA/wittypi/ && chmod +x $DATA/wittypi/*.sh && touch $DATA/wittypi/wittyPi.log $DATA/wittypi/schedule.log && log "seeded wittypi into /data"
fi
exit 0
