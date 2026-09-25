# life-guard firmware

The tamper guard: an ATtiny84 on the Witty Pi 4's always-on 3V3 pin, three normally-closed contacts, one siren, one LED. What it does and why is in `life-guard.ino`'s header and on the kit page. `life-guard.hex` is the compiled result and is what gets flashed; rebuild it only when the sketch changes.

Build (arduino-cli with [ATTinyCore](https://github.com/SpenceKonde/ATTinyCore)):

```
arduino-cli core install ATTinyCore:avr --additional-urls http://drazzy.com/package_drazzy.com_index.json
arduino-cli compile --fqbn ATTinyCore:avr:attinyx4:chip=84,clock=1internal --output-dir build .
cp build/life-guard.ino.hex life-guard.hex
```

Flash from the node's own Pi with `sudo bash flash.sh` (avrdude over GPIO 9/10/11/25). The status lines to the Pi are the ISP lines, so nothing extra is wired for programming.

## Pins

| ATtiny84 | Signal | Goes to |
| :-- | :-- | :-- |
| PA0, PA1, PA2 | lid, panel, tilt | NC contacts to GND; 1 M pull-up and 100 nF to GND on each |
| PA3 | DISARM | Pi GPIO 26 through 1 k; 100 k pull-down |
| PA4, PA5, PA6 | LOOP_A, LOOP_B, ALARM | Pi GPIO 11, 9, 10 through 1 k (also SCK, MISO, MOSI when flashing) |
| PA7 | SIREN | logic-level MOSFET gate (10 k pull-down), siren between load + and drain, 100 nF across the siren |
| PB0 | SW | 2N7002 gate; drain to Witty Pi SWITCH, source to Witty Pi GND |
| PB1 | LED | green LED through 1 k, out through the wall in an IP67 5 mm holder |
| PB2 | VOUT sense | Witty Pi VOUT through 10 k, 15 k to GND |
| PB3 | RESET | Pi GPIO 25 (flashing only); 10 k pull-up |
| VCC, GND | | Witty Pi extension header 3V3 and GND; 100 nF at the chip |

The siren takes its 12 V from the charge controller's load output through its own 1 A fuse, so the controller's low-charge cut-off ends an alarm nobody answered before the battery is flat.
