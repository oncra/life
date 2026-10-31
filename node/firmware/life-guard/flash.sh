#!/usr/bin/env bash
# Flash the guard from the Pi it sits on, over the same lines it reports on. No programmer to buy.
# Wiring while the guard board is fitted: Pi GPIO 10 (header pin 19) -> PA6 (MOSI), GPIO 9 (pin 21) -> PA5 (MISO),
# GPIO 11 (pin 23) -> PA4 (SCK), GPIO 25 (pin 22) -> PB3 (RESET). The RESET lead is on the guard only while flashing:
# afterwards it goes on the board's parking pin, because a Pi that is switched off pulls its GPIO 25 towards ground and
# would hold the guard in reset. Ground runs through the Witty Pi. Factory fuses (1 MHz internal, BOD off) are what we
# want; they are not touched.
#   sudo bash flash.sh [file.hex]     # default: life-guard.hex beside this script
#
# avrdude's linuxspi programmer: the Pi's SPI0 for the data and the GPIO character device for RESET (GPIO 25 is
# linuxspi's reset pin in avrdude.conf). Not linuxgpio: the avrdude in Debian 13 (7.1) drives that through sysfs,
# where kernels since 6.6 number the header pins from 512, and avrdude 7.1 refuses pin numbers above 400. SPI0 is
# switched on for this run only (spi0-0cs claims no chip-select pin) and off again, and the watcher is held while it
# runs, so nothing turns the three lines back into inputs mid-write. 100 kHz: the guard runs at 1 MHz, and
# in-system programming wants the clock below a quarter of that.
set -euo pipefail
HEX="${1:-$(dirname "$0")/life-guard.hex}"
DEV="${GUARD_SPIDEV:-/dev/spidev0.0}"
[ -r "$HEX" ] || { echo "flash.sh: no $HEX" >&2; exit 1; }
WATCH=$(systemctl is-active life-guard-watch 2>/dev/null || true)
systemctl stop life-guard-watch 2>/dev/null || true
cleanup() {
  dtoverlay -r spi0-0cs 2>/dev/null || true
  [ "$WATCH" = active ] && systemctl start life-guard-watch 2>/dev/null || true
}
trap cleanup EXIT
dtoverlay spi0-0cs
for _ in $(seq 50); do [ -e "$DEV" ] && break; sleep 0.1; done
[ -e "$DEV" ] || { echo "flash.sh: SPI0 did not come up (no $DEV)" >&2; exit 1; }
avrdude -c linuxspi -P "$DEV:/dev/gpiochip0" -B 10 -E noreset -p t84 -U flash:w:"$HEX":i
echo "flashed; move the RESET lead to the parking pin"
