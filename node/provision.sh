#!/usr/bin/env bash
# Install the Life node software onto a Raspberry Pi OS Lite (64-bit) root. Run as root, either inside the
# chroot that image/build.sh opens on a workstation, or on a running Pi before its overlay is enabled.
#
#   sudo bash node/provision.sh /path/to/birdnet-go-tarball-dir /path/to/wittypi-dir
#
# Nothing per-node happens here: tokens, hostname, WiFi and the schedule choice arrive later as
# life-node.env on the boot partition, which life-firstboot moves onto /data at the first boot.
# See image/README.md for the layout this produces.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BNG=${1:?dir with birdnet-go, libtensorflowlite_c.so, libonnxruntime.so}
WITTY=${2:?dir with the unpacked Witty Pi 4 software}
export DEBIAN_FRONTEND=noninteractive

# packages: Modbus (minimalmodbus is not in Debian, so pip), the modem stack, I2C tools for the Witty Pi,
# ALSA for the microphone, growpart for the data partition, overlayroot for the read-only root
apt-get install -y -qq python3-serial python3-pip python3-astral modemmanager network-manager i2c-tools alsa-utils cloud-guest-utils overlayroot unzip >/dev/null
pip install -q --break-system-packages minimalmodbus
python3 -c "import minimalmodbus, serial, astral"

# the node's own programs
install -m 0755 "$HERE/life-soil-agent.py" /usr/local/bin/life-soil-agent
install -m 0755 "$HERE/../clients/birdnet-pi-push.py" /usr/local/bin/life-push
install -m 0755 "$HERE/life-heartbeat.py" /usr/local/bin/life-heartbeat
install -m 0755 "$HERE/image/life-firstboot.sh" /usr/local/sbin/life-firstboot
install -m 0755 "$HERE/image/life-schedule.sh" /usr/local/sbin/life-schedule
install -d /usr/share/life-node/schedules /usr/share/life-node/wittypi
install -m 0644 "$HERE/image/schedules/"*.wpi /usr/share/life-node/schedules/
install -m 0644 "$HERE/life-node.env.example" /usr/share/life-node/life-node.env.example
cp -r "$WITTY"/. /usr/share/life-node/wittypi/ && chmod +x /usr/share/life-node/wittypi/*.sh

# BirdNET-Go, native arm64 release
install -m 0755 "$BNG/birdnet-go" /usr/local/bin/birdnet-go
install -m 0644 "$BNG/libtensorflowlite_c.so" "$BNG/libonnxruntime.so" /usr/local/lib/
ldconfig

# everything that must survive a reboot lives on /data (partition 3); root is a read-only tmpfs overlay
grep -q ' /data ' /etc/fstab || echo 'LABEL=life-data  /data  ext4  defaults,noatime  0  2' >> /etc/fstab
mkdir -p /data
ln -sfn /data/life-node /var/lib/life-node
ln -sfn /data/birdnet-go /var/lib/birdnet-go
rm -rf /etc/NetworkManager/system-connections && ln -sfn /data/nm-connections /etc/NetworkManager/system-connections
rm -rf /var/log/journal && ln -sfn /data/log/journal /var/log/journal
install -d /etc/systemd/journald.conf.d && install -m 0644 "$HERE/image/journald.conf" /etc/systemd/journald.conf.d/life.conf
install -m 0644 "$HERE/image/sshd-life.conf" /etc/ssh/sshd_config.d/life.conf
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub
systemctl disable regenerate_ssh_host_keys.service 2>/dev/null || true

# units and timers. The soil and push units read the per-node env from /data; the cursor and the
# BirdNET database are pinned to /data too, so a power cut never loses what was not yet posted.
install -m 0644 "$HERE"/life-soil.service "$HERE"/life-soil.timer "$HERE"/life-sound.service "$HERE"/life-sound.timer "$HERE"/life-flush.service /etc/systemd/system/
install -m 0644 "$HERE"/image/life-firstboot.service "$HERE"/image/life-schedule.service "$HERE"/image/birdnet-go.service "$HERE"/image/wittypi.service /etc/systemd/system/
sed -i 's#^EnvironmentFile=.*#Environment=LIFE_CURSOR=/data/life-node/push-cursor BIRDNET_DB=/data/birdnet-go/birdnet.db "LIFE_HEARTBEAT_CMD=/usr/local/bin/life-heartbeat --json"\nEnvironmentFile=/data/life-node/env#' /etc/systemd/system/life-soil.service /etc/systemd/system/life-sound.service /etc/systemd/system/life-flush.service
systemctl enable ssh life-firstboot.service life-schedule.service birdnet-go.service wittypi.service life-soil.timer life-sound.timer life-flush.service >/dev/null 2>&1
systemctl disable userconfig.service 2>/dev/null || true

# the Witty Pi's own installer does this: I2C on, its modules loaded
echo i2c-dev > /etc/modules-load.d/life-i2c.conf

# the user. Password comes from the environment at build time; SSH keys from image/authorized_keys if present.
# Pi OS ships a placeholder 'pi' (uid 1000, no login) that its first-boot dialog would rename; rename it here instead
if ! id life >/dev/null 2>&1; then
  if getent passwd 1000 >/dev/null; then
    old=$(getent passwd 1000 | cut -d: -f1); usermod -l life -d /home/life -m -s /bin/bash "$old"; groupmod -n life "$old" 2>/dev/null || true
  else
    useradd -m -u 1000 -s /bin/bash life
  fi
fi
usermod -aG sudo,dialout,i2c,audio,gpio,plugdev,netdev,video life
[ -n "${LIFE_USER_PASSWORD:-}" ] && echo "life:${LIFE_USER_PASSWORD}" | chpasswd
echo 'life ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/010-life-nopasswd && chmod 0440 /etc/sudoers.d/010-life-nopasswd
if [ -f "$HERE/image/authorized_keys" ]; then install -d -m 0700 -o life -g life /home/life/.ssh && install -m 0600 -o life -g life "$HERE/image/authorized_keys" /home/life/.ssh/authorized_keys; fi

# boot partition: I2S microphone (the INMP441 shows up as the "googlevoicehat" card), I2C for the Witty Pi,
# the on-board audio off so the microphone is the only card. cmdline: no first-boot root resize (root is
# fixed at 8 GiB, the data partition grows instead) and the read-only overlay from the first boot.
FW=/boot/firmware
if ! grep -q 'life node' $FW/config.txt; then cat >> $FW/config.txt <<'CFG'

# life node
dtparam=i2c_arm=on
dtparam=i2s=on
dtoverlay=googlevoicehat-soundcard
CFG
fi
sed -i 's/^dtparam=audio=on/dtparam=audio=off/' $FW/config.txt
sed -i 's/ resize$//; s/ resize / /' $FW/cmdline.txt
# recurse=0: /data and /boot/firmware stay real, writable mounts; only root is overlaid
grep -q 'overlayroot=tmpfs' $FW/cmdline.txt || sed -i 's/^/overlayroot=tmpfs:recurse=0 /' $FW/cmdline.txt
cp "$HERE/life-node.env.example" $FW/life-node.env.example
echo "provisioned"
