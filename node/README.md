# Life node v1: one box, one post, 4G

A single solar-powered node that hears (BirdNET on a Raspberry Pi Zero 2 W), reads two wired soil probes (RS485) and posts JSON to the oracle over LTE-M. No farm network, no LoRaWAN gateway, no WiFi access point. Bill of materials and prices: `/docs/kit`.

Software on the node:
- **BirdNET-Go** (or BirdNET-Pi) does the listening and species detection; only detections leave the node, so a 500 MB ten-year IoT SIM is enough.
- `life-soil-agent.py` reads the probes over Modbus RTU every 20 minutes, buffers when offline, posts to `/api/v1/ingest/soil`.
- `life-push` (= `clients/birdnet-pi-push.py`) posts new detections every 10 minutes to `/api/v1/ingest/sound`.
- `provision.sh` writes the tokens, enables the timers, configures the modem (ModemManager + NetworkManager, APN `iot.1nce.net`) and switches the root filesystem to overlay (read-only) so power cuts do not corrupt the SD card.

We build the image once ("golden image"), flash it per node with its three device tokens, and ship the box provisioned. The landowner mounts the post and pushes the probes in.
