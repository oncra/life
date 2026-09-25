#!/usr/bin/env bash
# Flash the guard from the Pi it sits on, over the same lines it reports on. No programmer to buy.
# Wiring while the guard board is stacked: Pi GPIO 10 -> PA6 (MOSI), GPIO 9 -> PA5 (MISO), GPIO 11 -> PA4 (SCK),
# GPIO 25 -> PB3 (RESET), GND -> GND. Factory fuses (1 MHz internal, BOD off) are what we want; they are not touched.
#   sudo bash flash.sh              # writes life-guard.hex beside this script
set -euo pipefail
HEX="${1:-$(dirname "$0")/life-guard.hex}"
CONF=$(mktemp)
cat > "$CONF" <<'C'
programmer
  id    = "pi";
  desc  = "Raspberry Pi GPIO bit-bang";
  type  = "linuxgpio";
  reset = 25;
  sck   = 11;
  mosi  = 10;
  miso  = 9;
;
C
avrdude -C +"$CONF" -c pi -p t84 -U flash:w:"$HEX":i
rm -f "$CONF"
