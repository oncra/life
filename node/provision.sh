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
PROBE_PROFILE=${PROBE_PROFILE:-sen0600}
LIFE_POST_BATCH=${LIFE_POST_BATCH:-3}
PROBE_POWER_GPIO=${PROBE_POWER_GPIO:-26}
ENV
install -m 0644 life-soil.service life-soil.timer life-sound.service life-sound.timer life-flush.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now life-soil.timer life-sound.timer && systemctl enable life-flush.service
# cellular. The Brovi/Huawei E3372-325 is a HiLink stick: it shows up as a USB ethernet interface with its own
# DHCP and NAT, so NetworkManager just takes an address from it. The APN (iot.1nce.net) is set ONCE in the
# stick's own web UI at http://192.168.8.1, not here. The nmcli gsm line below is only for a serial modem
# such as the SIM7080G HAT; it is harmless on a HiLink stick but does nothing.
[ "${MODEM_KIND:-hilink}" = "serial" ] && nmcli connection add type gsm ifname '*' con-name life-cell apn "${APN:-iot.1nce.net}" connection.autoconnect yes 2>/dev/null || true
# protect the SD card: read-only root with overlay, logs to RAM
raspi-config nonint enable_overlayfs 2>/dev/null || true
echo "provisioned; reboot"
