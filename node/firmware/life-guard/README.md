# life-guard firmware

The tamper guard: an ATtiny84 on the Witty Pi 4's always-on 3V3 pin, three normally-closed contacts, one siren, one LED. What it does and why is in `life-guard.ino`'s header and on the kit page. `life-guard.hex` is the compiled result and is what gets flashed; rebuild it only when the sketch changes.

Build (arduino-cli with [ATTinyCore](https://github.com/SpenceKonde/ATTinyCore)):

```
arduino-cli core install ATTinyCore:avr --additional-urls http://drazzy.com/package_drazzy.com_index.json
arduino-cli compile --fqbn ATTinyCore:avr:attinyx4:chip=84,clock=1internal --output-dir build .
cp build/life-guard.ino.hex life-guard.hex
```

Flash from the node's own Pi with `sudo bash flash.sh` (avrdude's linuxspi programmer: the Pi's SPI0 for the data, GPIO 25 for RESET, SPI switched on only for the run). The status lines to the Pi are the ISP lines, so the one extra wire for programming is RESET, and that one is on the guard only while flashing (below). Not avrdude's linuxgpio: the avrdude in Debian 13 (7.1) drives that through sysfs, where kernels since 6.6 number the header pins from 512, and it refuses pin numbers above 400.

## Pins

| ATtiny84 (DIP pin) | Signal | Goes to |
| :-- | :-- | :-- |
| PA0, PA1, PA2 (13, 12, 11) | lid, panel, tilt | NC contacts to GND; 1 M pull-up and 100 nF to GND on each |
| PA3 (10) | DISARM | Pi GPIO 26 (header pin 37) through 1 k; 100 k pull-down |
| PA4, PA5, PA6 (9, 8, 7) | LOOP_A, LOOP_B, ALARM | Pi GPIO 11, 9, 10 (header pins 23, 21, 19) through 1 k (also SCK, MISO, MOSI when flashing) |
| PA7 (6) | SIREN | IRLZ34N gate, 10 k pull-down; siren between its supply and the drain, 100 nF across the siren; source to GND |
| PB0 (2) | SW | 2N7000 gate, 1 M pull-down (a pin left floating while the guard is held in reset must not tap the Pi off); drain to Witty Pi SWITCH, source to GND |
| PB1 (3) | LED | green LED through 1 k, out through the wall in the panel holder |
| PB2 (5) | VOUT sense | Witty Pi VOUT through 10 k, 15 k to GND |
| PB3 (4) | RESET | 10 k pull-up to 3V3; Pi GPIO 25 (header pin 22) only while flashing, see below |
| VCC (1), GND (14) | | Witty Pi P3 3V3 and GND; 100 nF at the chip |

## Connections

The Witty Pi 4's seven-pin header P3, on its top edge, comes unpopulated: solder a strip of seven pins in. Seen from above, left to right: VOUT, 3V3, LED, ALARM, SWITCH, CATHODE, GND (UUGear's manual, section 11.2). The guard uses VOUT, 3V3, SWITCH and GND. Measure before plugging anything in: with the Pi off, 3V3 to GND reads 3.3 V and VOUT 0; with the Pi on, VOUT reads 5 V.

- **One ground, the Witty Pi's.** The guard's GND goes to GND on P3 and nowhere else. The Pi's own ground (CATHODE, and every GND pin on the 40-pin header) sits behind a 0.05 Ω resistor through which the Witty Pi measures the Pi's current; a second ground lead to the 40-pin header would bypass it, and the power figure in every heartbeat would read low.
- **RESET only while flashing.** A Pi that is switched off ties its GPIO 25 to its unpowered 3.3 V rail through the pin's protection diode, which can pull the guard's RESET low enough to hold it in reset, exactly while it has to watch. The lead from header pin 22 goes on the guard's RST pin to flash, and on its parking pin, connected to nothing, the rest of the time.
- **The Pi's header.** The five leads (pins 19, 21, 22, 23 and 37) sit in one 2×20 plug housing over the pins that come through the top of the Witty Pi, pin 1 marked, so they cannot come loose one by one or land on the wrong pins.
- **The siren's supply.** On a field node the charge controller's load output, through its own 1 A fuse, so the controller's low-charge cut-off ends an alarm nobody answered before the battery is flat. A bench node on a 5 V supply has no 12 V: a 9 V battery or a 9 to 12 V adapter does (the PS-583Q works from 5 to 15 V, 300 mA at most at 12 V), its minus on the guard's GND. A green LED with 1 k in the siren's place keeps the bench tests quiet.
- **SPI stays off.** `flash.sh` switches SPI0 on for the minute it flashes and off again. With `dtparam=spi=on` in config.txt the three status lines would belong to the SPI driver, not to `life-guard`.
- **The Pi already up.** The guard can only boot a Pi that is off; with the Pi up in a listening window it chirps and waits. `life-guard-watch.service` reads the ALARM line every two seconds while the Pi is up and runs the same check as an alarm boot the moment it rises, so the report and the silence come within seconds, not at the next push. While an alarm stands it asks the oracle again every five minutes for half an hour, so a window set after the siren started still silences it.
