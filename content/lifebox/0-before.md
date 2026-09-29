---
title: "Stage 0. Before the parcels"
short: "Tokens, a golden image and the missing orders. Needs no hardware."
order: 1
stage: "0"
produces: "tokens, a golden image, the missing orders"
gate: "a synthetic reading visible on the bench place, and the image boots on a Pi"
status: now
parts: [SIM]
---

# Stage 0. Before the parcels

None of this needs the box, so none of it is an excuse to wait.

**0.1 Bench place and three device tokens. Done 19 September.** Place `bench-tolhuisweg`, private, with a SOUND device and two SOIL devices (10 cm on Modbus address 1, 30 cm on address 2). The three `lo_dev_` tokens are in the password manager and go into `life-node.env` as `LIFE_DEVICE_TOKEN`, `LIFE_DEVICE_TOKEN_SOIL_1`, `LIFE_DEVICE_TOKEN_SOIL_2`.

**0.2 Prove the chain with synthetic rows. Done for two of three.** One soil row was posted by hand on 19 September (the 10 cm device shows it as last seen) and the SOUND device received a heartbeat on 25 September. The 30 cm device has never been posted to. Post one row as it and watch only its `lastSeenAt` move:

```bash
curl -s -XPOST https://life.oncra.org/api/v1/ingest/soil -H "authorization: Bearer $TOK_SOIL_2" \
  -H 'content-type: application/json' -d '{"readings":[{"ts":"2026-09-30T12:00:00Z","vwc":24.1,"tempC":15.3}]}'
```

**0.3 Order what is still missing.** The SIM and the battery are bought. Left: the **panel** (decide 100 W under a canopy or 40 to 50 W in the open, then [Accuweb](https://www.accuweb.nl/zonnepaneel-12-volt-100-watt.html) or the Dekker/Accuweb 40 to 50 W lines in the ledger) and the **bouwmarkt run**: matt green outdoor paint for plastic plus primer, 1 m of 2 x 2.5 mm² red/black, M5 ring terminals, an inline blade fuse holder with a 15 A fuse, a 3 mm plastic sheet cut to 300 x 200, open-cell foam, a small rigid cap for the mic hood, and the 2 m class 4 post with M8 through-bolts. None of it blocks stage 1.

**0.4 Boot the golden image on the Pi. Not done.** The image (`node/image/build.sh`) exists and has been inspected on a workstation only. Flash it, copy `life-node.env` with the three tokens, `SCHEDULE=bench` and the desk WiFi onto the boot partition, boot, then check:

```bash
systemctl list-timers            # life-soil.timer and life-sound.timer present
touch /data/life-node/probe && sudo reboot   # the file must survive
ls /data/life-node
```

Three things must be right in the image or they are wrong in every node built from it: audio clip saving off, all node state under `/data`, per-node settings arriving on the boot partition.

## Gate

The 30 cm device shows a `lastSeenAt`, and a card boots with both timers listed and a file that survives a reboot.
