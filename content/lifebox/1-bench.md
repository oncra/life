---
title: "Stage 1. Bench electronics"
short: "Everything loose on a desk on a USB supply. One thing added at a time, a line in the log after each."
order: 2
stage: "1"
produces: "probes, microphone and modem working loose on a desk"
gate: "one detection and two soil rows over LTE, and a measured awake draw"
status: next
parts: [Computer, Storage, Bench supply, Instrument, I2S header, Microphone, Mic wiring, RS485 adapter, Soil probe, probe power, Modem, SIM, terminations]
---

# Stage 1. Bench electronics, nothing in a box

No enclosure, no battery, no charge controller. The Pi runs from the official 15 W supply through the USB-C inline meter.

**1.1 Inventory against the order list.** Tick the parts table below against the parcels. Meter the SEN0600 leads before applying power: DFRobot publishes no colour code.

**1.2 Measure the Pi alone.** The most important half hour of the build. Every energy number on the kit page rests on "about 5 W while awake" and nobody has measured it. Write three numbers into the bench log: idle at the prompt, boot peak in the first 20 s, steady state with BirdNET-Go running after ten minutes, and the supply voltage under load. Above about 6.5 W awake the summer margin is gone and the schedule or the panel changes.

**1.3 Re-address the probes.** Both ship on Modbus address 1. With **one** probe on the bus:

```bash
life-soil-agent --scan                      # who answers, and the raw registers
life-soil-agent --set-address 2 --addr 1    # write register 0x07D0
life-soil-agent --scan                      # confirm, then connect both
```

Air reads near zero moisture, a glass of water near saturation, a hand round the prongs moves the temperature within a minute. Stable raw words with nonsense values mean the `sen0600` profile is wrong, not the probe: fix the profile from the words.

**1.4 First real soil reading.** Both probes, addresses 1 and 2, tokens in place. Run the agent once by hand, then let the timer do it, and watch both SOIL devices' `lastSeenAt` move on the bench place.

**1.5 Microphone.** Stacking header on first so the I2S pins stay reachable once the Witty Pi is on. INMP441 on pins 18, 19 and 20 with a 10 cm lead, level check with `arecord`, then let BirdNET-Go listen. Play a known bird call from a phone: a confident detection of the right species is the gate. Hiss in an empty room is a wiring or gain fault, not a quiet room.

**1.6 Modem and SIM.** Stick in, APN in its web UI at `http://192.168.8.1`, then a full cycle over LTE with WiFi and ethernet disabled. Record the bytes per hourly post: the SIM budget assumes about 12 kB, dominated by the TLS handshake. `life-heartbeat --json` must print the stick's PLMN and cell id; after the next push the SOUND device shows a heartbeat time and that cell becomes the node's home. Carry the bench to another cell and the oracle must raise *moved*.

## Gate

Both probes answer on their own addresses, one detection and two soil rows arrived at the bench place over LTE, and the awake draw is a number in the log.
