---
title: "Stage 3. The box"
short: "Paint, plastic plate, mic port, glands, coating, the guard. Then a hose."
order: 4
stage: "3"
produces: "a sealed, painted, coated enclosure with the guard armed"
gate: "a closed box completes a cycle, dry after a hose test, guard passes its four tests"
status: later
parts: [Enclosure, Cable glands, mounting plate, mounting, paint, mic port, windscreen, mic hood, conformal coating, tape, consumables, Guard MCU, Siren, Reed contacts, Magnets, Tilt switch, Siren MOSFET, Switch MOSFET, LED, LED holder, IC socket, Perfboard, Pin header, Resistors, Capacitors, Guard hardware]
---

# Stage 3. The box

**3.0 Regenerate the drawings first.** The three SVGs assume a 1010 x 540 panel. Whatever panel is bought (1190 x 540 for the 100 W), fix `kit/draw-low-mount.py`, `kit/draw-wiring.py` and `kit/draw-energy.py` and re-run them. Never drill against an out-of-date drawing.

**3.1 Paint the enclosure** before anything goes in. The box is ABS, not UV-stable. Matt green outdoor paint for plastic, primer unless the can says it bonds to ABS. UV protection first, camouflage second.

**3.2 Lay out on the 3 mm plastic sheet**, not the steel plate the box ships with: steel beside the 4G stick detunes its antenna. Nylon standoffs. The battery lies flat and decides the layout.

**3.3 The microphone port.** A 5 mm hole, the ePTFE membrane over it inside, the INMP441 gasketed **against** the wall (bottom-port MEMS: an air gap becomes a resonant cavity). A small rigid hood outside, foam inside it, opening down. Until the membrane arrives (12 to 24 October) test with a bare port and record the difference later.

**3.4 Glands.** Five M20, all pointing down: panel lead, two probe leads, one vented at the lowest point, one spare blanked. Cut the panel's MC4 connectors off, ferrule, straight into the MPPT.

**3.5 Conformal coat** the Pi, the RS485 adapter and the microphone board with the Plastik 70; mask the mic port and every connector first.

**3.6 Dry test, then wet test.** Closed box, full cycle, and write down the 4G signal strength from inside with the lid on: that number decides whether the internal antenna survives. Then five minutes with a garden hose from every angle, open, look. Re-measure the draw with the lid on in the sun.

**3.7 The guard.** Build `node/firmware/life-guard` on the perfboard, stack it on the Witty Pi's extension header, flash from the Pi with `flash.sh`, set `GUARD=1`. Reed in the lid, reed on the panel bracket, tilt switch upright. Four tests in order, siren wired last: status reads `armed` and names each loop; lid open without a window chirps, boots the Pi, raises TAMPER within a minute, siren at sixty seconds; `PUT .../maintenance {"hours": 1}` then lid open: chirps, green LED, silence; window set and lid open after the hourly heartbeat: no chirp. Record the seconds from lid to green.

## Gate

A closed box completes a cycle, the signal strength is written down, the inside is dry, and the guard passes its four tests.
