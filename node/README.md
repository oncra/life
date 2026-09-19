# Life node v1: one box, one post, 4G

A single solar-powered node that hears (BirdNET on a Raspberry Pi 4; the Pi Zero 2 W would halve the power draw but is out of stock in the EU until December 2026 and BirdNET-Go dropped support for it), reads two wired soil probes (RS485) and posts JSON to the oracle over LTE-M. No farm network, no LoRaWAN gateway, no WiFi access point. Bill of materials and prices: `/docs/kit`.

Software on the node:
- **BirdNET-Go** (or BirdNET-Pi) does the listening and species detection; only detections leave the node, so a 500 MB ten-year IoT SIM is enough.
- `life-soil-agent.py` reads the probes over Modbus RTU every 20 minutes, buffers when offline, posts to `/api/v1/ingest/soil`.
- `life-push` (= `clients/birdnet-pi-push.py`) posts new detections every 10 minutes to `/api/v1/ingest/sound`.
- `provision.sh` installs all of it onto a Raspberry Pi OS Lite root, and `image/build.sh` runs it inside a stock image on a workstation to make the golden image: read-only overlay root, a writable `/data` partition for everything that must persist, BirdNET-Go with clip saving off, the Witty Pi daemon and the season's schedule. Per-node settings (tokens, hostname, coordinates) go on the boot partition as `life-node.env` after flashing; see `image/README.md`.

The schedule is seasonal: about ten hours a day from March to October, **one hour a day from November to February**, at a fixed clock time so the winter sample does not drift around the daily cycle. Set it in the Witty Pi schedule script. The soil timer keeps its 20-minute interval; in winter that simply yields three readings on the hour the node is awake, which is plenty for soil that moves slowly.

The probes take 5 V from a USB-A breakout on the Pi, so they are powered exactly when the Pi is: the Witty Pi switches them for free. Do not wire them to the charge controller's load output, which is never itself switched; there they would draw around 0.5 W all day and night, more than the whole winter budget. (`PROBE_POWER_GPIO` still exists for a build that wants a MOSFET-switched 12 V rail instead.)

**Audio clip saving must be off in BirdNET-Go.** Detections leave the node, sound does not. It is what keeps the node honest with the people whose land it sits on, and what keeps a 500 MB SIM alive for ten years.

The order of work for building one is `/docs/build`. Before a node is built: **both soil probes leave the factory on Modbus address 1**, so on one bus they collide and neither answers. On the bench, with only that probe connected:

```
life-soil-agent --scan                      # who answers, and with what raw registers
life-soil-agent --set-address 2 --addr 1    # write register 0x07D0
life-soil-agent --scan                      # confirm, then wire both
```

`--scan` prints the raw words next to the decoded values, because the profiles here were written from datasheets: stable words with nonsense values mean the register map is wrong and not the probe. The SEN0600 carries moisture and temperature only, so it uses the `sen0600` profile, which reads two registers; `generic-thc` reads a third for EC that this probe has not got.

We build the image once ("golden image", `image/`), flash it per node, drop that node's `life-node.env` with its three device tokens on the boot partition, and ship the box provisioned. The landowner mounts the post and pushes the probes in.


## Specified, not yet built

Four things borrowed from [acoupi](https://github.com/acoupi/acoupi) after reading its source. We are not taking the dependency: it runs on Celery with a RabbitMQ broker, which suits a device that stays powered rather than one that boots twice a day in winter, and it is GPL-3.0 against this repository's Apache-2.0. The designs are worth having anyway.

1. **Queue in SQLite on the writable partition.** Replace `queue.jsonl` with a table holding the message, its creation time, and the server's response. Do not delete on success: a reading that was accepted and one that was never sent should still be distinguishable a month later.
2. **Heartbeat with metrics.** Hourly, alongside the data: device id, status, battery voltage if the charge controller is readable over VE.Direct, free disk, CPU temperature, uptime, count of unsent messages. Silent and struggling are different failures.
3. **Dawn and dusk on the node.** Use `astral` with the place's coordinates to compute the next window and write it to the Witty Pi before shutdown, instead of a nightly cron rewrite of an absolute-time schedule.
4. **Bounded sending.** Oldest first, with a cap per run, so a node returning from a week offline does not spend a month of SIM budget in one afternoon.
