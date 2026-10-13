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
# The battery guard. Below WITTYPI_LOW_V at its input the board shuts the Pi down cleanly, and after such a stop it
# switches the Pi on again once its input is above WITTYPI_RECOVERY_V, which on a node means the panel is charging.
# Both are needed: with only the low level the board skips a scheduled start that comes while the battery is still
# low, and the alarm does not come round again for a month. The charge controller's own load disconnect sits lower
# and cuts hard; on node 1's first battery test it let a LiFePO4 run down into its BMS (12 October 2026). life-window
# sends a node the board woke outside its windows back to sleep. The board keeps both levels (registers 19 and 22, in
# tenths of a volt, 255 = off); they are written only when they change. WITTYPI_LOW_V=0 switches the guard off, for a
# node on a mains adapter, whose 12 V would sit below the low level; the recovery level then goes off with it, because
# on its own it switches the Pi on whenever the input is above it, so the node could never sleep.
lowv=${WITTYPI_LOW_V:-12.6}; recv=${WITTYPI_RECOVERY_V:-13.2}
tenths() { awk -v v="$1" 'BEGIN { if (v + 0 == 0) print 255; else if (v >= 2 && v <= 25) printf "%d\n", v * 10 + 0.5; else print "bad" }'; }
lo=$(tenths "$lowv"); re=$(tenths "$recv")
[ "$lo" = 255 ] && re=255
if [ "$lo" = bad ] || [ "$re" = bad ]; then
  echo "life-wittypi: WARNING battery guard out of range (2.0 to 25.0 V, or 0 for off): low $lowv, recovery $recv; left as it is"
elif [ "$lo" != 255 ] && [ "$re" != 255 ] && [ "$re" -le "$lo" ]; then
  echo "life-wittypi: WARNING recovery $recv V must be above the low-voltage stop $lowv V; left as it is"
else
  [ "$(r 19)" != "$lo" ] && i2cset -y $BUS $ADDR 19 "$lo" && echo "life-wittypi: low-voltage stop set to $lowv V"
  [ "$(r 22)" != "$re" ] && i2cset -y $BUS $ADDR 22 "$re" && echo "life-wittypi: recovery set to $recv V"
  [ "$lo" != 255 ] && [ "$re" = 255 ] && echo "life-wittypi: WARNING a low-voltage stop without a recovery level can leave the node asleep until someone presses the button"
  [ "$lo" != 255 ] && [ $((vin * 10 + vind / 10)) -lt "$lo" ] && echo "life-wittypi: WARNING input ${vin}.$(printf %02d $vind) V is below the low-voltage stop; the board will shut the Pi down (a mains adapter wants WITTYPI_LOW_V=0)"
fi
lvl() { local x; x=$(r "$1"); [ "$x" = 255 ] && echo off || awk -v t="$x" 'BEGIN { printf "%.1f V\n", t / 10 }'; }
echo "life-wittypi: Witty Pi (id $id) in the supply path, input ${vin}.$(printf %02d $vind) V, default ON $(r 17), stop below $(lvl 19), on again above $(lvl 22)"
exit 0
