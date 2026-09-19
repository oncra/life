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
set -a; . $DATA/life-node/env; set +a

# 3. hostname (root is tmpfs, so this is redone every boot; cheap)
H=${NODE_HOSTNAME:-life-node}
hostname "$H"; echo "$H" > /etc/hostname; sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$H/" /etc/hosts; grep -q '^127.0.1.1' /etc/hosts || echo -e "127.0.1.1\t$H" >> /etc/hosts

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
