#!/usr/bin/env bash
# Provision a life node image. Run ON the Pi (Raspberry Pi OS Lite 64-bit, Zero 2 W) after BirdNET-Go is installed.
# Usage: sudo LIFE_DEVICE_TOKEN=... LIFE_DEVICE_TOKEN_SOIL_1=... LIFE_DEVICE_TOKEN_SOIL_2=... APN=iot.1nce.net bash provision.sh
set -euo pipefail
apt-get update -qq && apt-get install -y -qq python3-minimalmodbus python3-serial modemmanager network-manager >/dev/null
install -m 0755 life-soil-agent.py /usr/local/bin/life-soil-agent
curl -fsSL https://raw.githubusercontent.com/oncra/life/main/clients/birdnet-pi-push.py -o /usr/local/bin/life-push && chmod 0755 /usr/local/bin/life-push
umask 077
cat > /etc/life-node.env <<ENV
LIFE_API=${LIFE_API:-https://life.oncra.org/api/v1}
LIFE_DEVICE_TOKEN=${LIFE_DEVICE_TOKEN}
LIFE_DEVICE_TOKEN_SOIL_1=${LIFE_DEVICE_TOKEN_SOIL_1:-}
LIFE_DEVICE_TOKEN_SOIL_2=${LIFE_DEVICE_TOKEN_SOIL_2:-}
RS485_PORT=${RS485_PORT:-/dev/ttyUSB0}
PROBE_ADDRESSES=${PROBE_ADDRESSES:-1,2}
PROBE_PROFILE=${PROBE_PROFILE:-generic-thc}
ENV
install -m 0644 life-soil.service life-soil.timer life-sound.service life-sound.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now life-soil.timer life-sound.timer
# cellular: ModemManager + NetworkManager bring the SIM7080G / SIM7600 up as a GSM connection
nmcli connection add type gsm ifname '*' con-name life-cell apn "${APN:-iot.1nce.net}" connection.autoconnect yes 2>/dev/null || true
# protect the SD card: read-only root with overlay, logs to RAM
raspi-config nonint enable_overlayfs 2>/dev/null || true
echo "provisioned; reboot"
