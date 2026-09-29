---
title: "What we have"
short: "Every element that exists today: parts bought, software written, the oracle waiting. And what is still missing."
order: 0
status: now
---

# What we have

## Hardware, as bought for node 1

The table below is read live from [`kit/node-1-purchases.csv`](https://github.com/oncra/life/blob/main/kit/node-1-purchases.csv). The per-part list with prices and links, [`kit/order-list.csv`](https://github.com/oncra/life/blob/main/kit/order-list.csv), is the source of truth for the design and sits under each stage page.

**Two lines on the kit page no longer match what was bought.** The battery is the Green Cell 10 Ah (128 Wh), not the reichelt 20 Ah: with an unshaded panel and a four-hour shoulder schedule in March and October it is enough, on PVGIS off-grid runs. The panel is **not ordered**, and the ledger says 40 to 50 W rather than 100 W, on condition that the panel stands unshaded. That condition has to be decided per site before the panel is bought; under a crop canopy the 100 W stands.

## Software, written and in the repository

| Element | Where | State |
| :-- | :-- | :-- |
| Golden image builder: read-only root, writable `/data`, BirdNET-Go with clips off, Witty Pi daemon, seasonal schedules | `node/image/` | built and inspected on a workstation; **never booted on a Pi** |
| Soil agent: Modbus RTU every 20 min, `--scan`, `--set-address`, offline queue | `node/life-soil-agent.py` | written from the datasheet; **never seen a probe** |
| Push + heartbeat: hourly detections post with uptime, temperature, disk, queue, serving cell | `clients/birdnet-pi-push.py`, `node/life-heartbeat.py` | heartbeat tested end to end against the bench place |
| Flush on shutdown, timers, provisioning | `node/life-flush.service`, `*.timer`, `provision.sh` | provisioning has run only inside the image build |
| Tamper guard: ATtiny84 firmware, hex, `flash.sh`, Pi side with maintenance windows | `node/firmware/life-guard`, `node/life-guard.py` | compiled; parts ordered; **never flashed on hardware** |
| Oracle: ingest routes, `SILENT` / `MOVED` / `TAMPER` alerts, maintenance windows, push to the console | `src/lib/alerts.ts`, `/api/v1/...` | live on life.oncra.org |
| Bench place `bench-tolhuisweg` with three device tokens | oracle | registered 19 Sep; one synthetic soil row and one heartbeat received |

## Still missing

- **A first boot of the image on the Pi.** Stage 0's gate.
- **Every measurement.** The bench log has its rows and an empty measured column throughout.
- **The panel** (decision: 100 W under a canopy, 40 to 50 W in the open) and the bouwmarkt run: paint and primer, battery lead, ring terminals, 15 A fuse, 3 mm plastic sheet, foam, the post.
- **The membrane** for the microphone port arrives 12 to 24 October; the bench does not wait for it.
