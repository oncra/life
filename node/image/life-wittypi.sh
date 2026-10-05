#!/bin/bash
# Life node: runs before the Witty Pi daemon and the schedule (ExecCondition in both units). Exits 0 only
# when a Witty Pi 4 answers on I2C and sits in the supply path, i.e. its own input voltage is up. Otherwise
# both are skipped for this boot: a schedule that shuts the Pi down with nothing in the supply path to cut
# and restore power leaves a halted Pi drawing about 1.8 W that never wakes (node 1, 30 September 2026).
# When it passes, it makes sure the board switches the Pi on as soon as it gets power (default ON), so a
# node whose battery ran flat comes back by itself when the charge controller switches its load on again,
# instead of waiting for someone to press K1. WITTYPI_DEFAULT_ON=0 in the env keeps the button behaviour.
set -u
set -a; [ -f /data/life-node/env ] && . /data/life-node/env; set +a
BUS=1; ADDR=0x08
r() { local v; v=$(i2cget -y $BUS $ADDR "$1" 2>/dev/null) || return 1; echo $((v)); }
id=$(r 0) || { echo "life-wittypi: no Witty Pi on I2C bus $BUS, skipping"; exit 1; }
vin=$(r 1); vind=$(r 2)
if [ "$vin" -lt 3 ]; then
  echo "life-wittypi: Witty Pi present but not in the supply path (input ${vin}.${vind} V), skipping"; exit 1
fi
# the board only cuts power after a shutdown when it can see UART0's TXD, and only after the daemon's SYS_UP
grep -q "^enable_uart=1" /boot/firmware/config.txt && grep -q "^dtoverlay=disable-bt" /boot/firmware/config.txt \
  || echo "life-wittypi: WARNING config.txt lacks enable_uart=1 / dtoverlay=disable-bt; the board cannot see the Pi shut down"
command -v gpio >/dev/null || echo "life-wittypi: WARNING wiringPi gpio is missing; the Witty Pi daemon will exit and never send SYS_UP"
want=${WITTYPI_DEFAULT_ON:-1}
if [ "$(r 17)" != "$want" ]; then
  i2cset -y $BUS $ADDR 17 "$want" && echo "life-wittypi: default ON set to $want"
fi
echo "life-wittypi: Witty Pi (id $id) in the supply path, input ${vin}.$(printf %02d $vind) V, default ON $(r 17)"
exit 0
