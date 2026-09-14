# Life node v1: one box, one post, 4G

A single solar-powered node that hears (BirdNET on a Raspberry Pi 4; the Pi Zero 2 W would halve the power draw but is out of stock in the EU until December 2026 and BirdNET-Go dropped support for it), reads two wired soil probes (RS485) and posts JSON to the oracle over LTE-M. No farm network, no LoRaWAN gateway, no WiFi access point. Bill of materials and prices: `/docs/kit`.

Software on the node:
- **BirdNET-Go** (or BirdNET-Pi) does the listening and species detection; only detections leave the node, so a 500 MB ten-year IoT SIM is enough.
- `life-soil-agent.py` reads the probes over Modbus RTU every 20 minutes, buffers when offline, posts to `/api/v1/ingest/soil`.
- `life-push` (= `clients/birdnet-pi-push.py`) posts new detections every 10 minutes to `/api/v1/ingest/sound`.
- `provision.sh` writes the tokens, enables the timers, configures the modem (ModemManager + NetworkManager, APN `iot.1nce.net`) and switches the root filesystem to overlay (read-only) so power cuts do not corrupt the SD card.

Before a node is built: **both soil probes leave the factory on Modbus address 1**. Re-address one of them to 2 by writing register `0x07D0`, on the bench, with only that probe on the bus. Two probes sharing an address collide and neither reads. The SEN0600 carries moisture and temperature only, so it uses the `sen0600` profile, which reads two registers; `generic-thc` reads a third for EC that this probe has not got.

We build the image once ("golden image"), flash it per node with its three device tokens, and ship the box provisioned. The landowner mounts the post and pushes the probes in.
