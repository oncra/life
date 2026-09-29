---
title: "What we have"
short: "Every element that exists today: parts on the table, software written, the oracle waiting. And what is still missing."
order: 0
status: now
---

# What we have

![Everything that had arrived for node 1 on 29 September 2026, laid out on a kitchen table: enclosure with glands, two soil probes, Raspberry Pi 4 with the Witty Pi already on it, power supply and meter, 4G stick, charge controller, crimping tool, ferrules, standoffs, jumper wires, heat shrink, lacquer](../../public/img/build/2026-09-29-parcels-arrived.webp "29 September 2026: the parcels from reichelt, UUGear, TelecomShop, Kiwi, Amazon.nl and DigiKey, on the table. Not in the picture yet: the SIM, the battery, the guard parts and the microphone membrane.")

## On the table

Almost everything the bench needs. The Pi already wears its Witty Pi. Two of the four soil probes are visible; count all four against the DigiKey packing slip. The small "flexlight" mounting set with the glue tube and the four beige sleeves is not on our order list and may belong to another parcel. The full ledger is on the [plan overview](index.md) and each stage page lists the parts it uses.

**Two lines on the kit page no longer match what was bought.** The battery is the Green Cell 10 Ah (128 Wh), not the reichelt 20 Ah. The panel is **not ordered**: the ledger says 40 to 50 W where the panel stands in the open, 100 W under a crop canopy. That is a per-site decision, to make before the panel is bought.

## Software, written and in the repository

| Element | Where | State |
| :-- | :-- | :-- |
| Golden image builder: read-only root, writable `/data`, BirdNET-Go with clips off, Witty Pi daemon, seasonal schedules | `node/image/` | built and inspected on a workstation; **never booted on a Pi** |
| Soil agent: reads the probes every 20 min, `--scan`, `--set-address`, offline queue | `node/life-soil-agent.py` | written from the datasheet; **never seen a probe** |
| Push and heartbeat: hourly detections post with uptime, temperature, disk, queue and the 4G cell | `clients/birdnet-pi-push.py`, `node/life-heartbeat.py` | heartbeat tested end to end against the bench place |
| Flush on shutdown, timers, provisioning | `node/life-flush.service`, `*.timer`, `provision.sh` | provisioning has run only inside the image build |
| Tamper guard: ATtiny84 firmware, hex, `flash.sh`, Pi side with maintenance windows | `node/firmware/life-guard`, `node/life-guard.py` | compiled; parts on the way; **never flashed on hardware** |
| Oracle: ingest routes, `SILENT` / `MOVED` / `TAMPER` alerts, maintenance windows, push to the console | `src/lib/alerts.ts`, `/api/v1/...` | live on life.oncra.org |
| Bench place `bench-tolhuisweg` with three device tokens | oracle | registered 19 Sep; one synthetic soil row and one heartbeat received |

```ai Check what the repository says we have, and what the oracle has heard
# Life Box build plan, have (https://life.oncra.org/lifebox/have): Check what the repository says we have, and what the oracle has heard. Cold start? Read the first box on https://life.oncra.org/lifebox.
: "${LIFE_ADMIN_KEY:?export LIFE_ADMIN_KEY first: the oracle steward key from the plan maintainer, or your own oracle ADMIN_API_KEY}"
[ -d life ] || git clone -q https://github.com/oncra/life; cd life
python3 - <<'PY'
import csv
rows=[r for r in csv.DictReader(open('kit/order-list.csv')) if r['basket']!='alt']
for r in rows: print(f"{r['item']:<20} {r['shop']:<28} {r['checked']}")
PY
curl -s -H "authorization: Bearer $LIFE_ADMIN_KEY" https://life.oncra.org/api/v1/places/bench-tolhuisweg/devices \
 | python3 -c "import sys,json;[print(d['kind'],d.get('depthCm'),'lastSeen',d['lastSeenAt'],'heartbeat',d['lastHeartbeatAt']) for d in json.load(sys.stdin)['items']]"
# Report: which lines are bought, which are estimates, and which device has never posted.
```

## Still missing

- **A first boot of the image on the Pi.** Stage 0's last gate.
- **Every measurement.** The bench log has its rows and an empty measured column throughout.
- **The SIM** (1NCE, on its way by UPS). Only the modem step waits for it.
- **The battery** (Green Cell, on its way by GLS) and the **guard parts** (reichelt, DPD). Stage 2 and stage 3.
- **The panel** (decide 100 W under a canopy or 40 to 50 W in the open) and the bouwmarkt run: paint and primer, battery lead, ring terminals, 15 A fuse, 3 mm plastic sheet, foam, the post.
- **The membrane** for the microphone port, 12 to 24 October. The bench does not wait for it.
