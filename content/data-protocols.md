---
title: "Data delivery protocols"
summary: "How detections, acoustic indices and soil readings get into the oracle: direct API, The Things Stack webhook, BirdNET-Pi, AudioMoth cards, BirdWeather."
order: 7
---

# Data delivery protocols

All deliveries are HTTPS JSON to `https://life.oncra.org/api/v1/ingest/...` with the **device token** (`lo_dev_…`) as `Authorization: Bearer`. Times are ISO 8601 with time zone. Nothing is ever deleted by a delivery; duplicates are your responsibility (send each detection once). Raw audio is never uploaded.

## Sound: detections and indices

```http
POST /api/v1/ingest/sound
Authorization: Bearer lo_dev_…
Content-Type: application/json

{
  "detections": [
    {"ts":"2026-05-04T04:32:10+02:00","species":"Eurasian Skylark","scientific":"Alauda arvensis","confidence":0.91,"detector":"birdnet-2.4","durationS":3},
    {"ts":"2026-05-04T06:10:00+02:00","species":"Engine","confidence":0.8,"detector":"birdnet-2.4","durationS":3}
  ],
  "indices": [
    {"ts":"2026-05-04T05:00:00+02:00","windowS":3600,"aci":1523.2,"ndsi":0.62,"biophony":0.71,"anthrophony":0.09}
  ]
}
```

Up to 5,000 detections and 5,000 index rows per request. Species strings are the detector's label; keep them as the detector gives them (BirdNET common names) so that places can be compared.

### From a BirdNET-Pi or BirdNET-Go

Copy `clients/birdnet-pi-push.py` from the repository to the Pi, put the device token in `/etc/life-oracle.env`, and add a cron line every ten minutes. The script reads the detections SQLite database, pushes rows newer than its last watermark, and keeps the watermark in `~/.life-oracle-cursor`.

```bash
sudo apt install -y python3-requests
curl -fsSL https://raw.githubusercontent.com/oncra/life/main/clients/birdnet-pi-push.py -o /usr/local/bin/life-push
chmod +x /usr/local/bin/life-push
echo 'LIFE_DEVICE_TOKEN=lo_dev_…' | sudo tee /etc/life-oracle.env
( crontab -l; echo '*/10 * * * * . /etc/life-oracle.env && /usr/local/bin/life-push' ) | crontab -
```

### From AudioMoth (or any) SD cards

On a laptop with [BirdNET-Analyzer](https://github.com/birdnet-team/BirdNET-Analyzer) installed:

```bash
birdnet-analyzer analyze /media/card/ --lat 52.05 --lon 5.05 --week -1 --rtype csv --output ./out
python3 clients/audiomoth-birdnet-push.py ./out --token lo_dev_… --tz Europe/Amsterdam
```

The push script reads BirdNET's CSV output, derives the timestamp of each detection from the AudioMoth file name (`20260504_043200.WAV` plus the offset inside the file) and posts in batches. Optional: `--indices` also computes hourly ACI and NDSI with scikit-maad and posts them.

### From a BirdWeather PUC

Give the operator your BirdWeather station id (or add it to the device `notes` as `birdweather:<id>`). A scheduled job polls BirdWeather's public API hourly and posts to your device. Specified, not yet built; until then, export CSV from BirdWeather and post it with `clients/audiomoth-birdnet-push.py --birdweather-csv`.

## Soil: direct

```http
POST /api/v1/ingest/soil
Authorization: Bearer lo_dev_…

{"readings":[{"ts":"2026-09-12T10:00:00Z","depthCm":10,"vwc":27.4,"tempC":16.8,"ec":310}]}
```

Units: VWC in percent, temperature in °C, EC in µS/cm.

## Soil: The Things Stack webhook

In your The Things Stack application: Integrations → Webhooks → Add webhook → Custom:

- Base URL: `https://life.oncra.org/api/v1/ingest/ttn`
- Additional header: `Authorization` = `Bearer lo_dev_…` for a **one-device application**, or `Bearer lo_key_…` (your steward key) for an application with many devices. In the second case every device must be registered on the place with its **DevEUI**; uplinks are matched on `end_device_ids.dev_eui`.
- Enable only "Uplink message".

The webhook receives the standard uplink JSON and reads `uplink_message.decoded_payload`. Recognised field names:

| Maker | Fields |
| --- | --- |
| Dragino LSE01 / SE01-LB | `water_SOIL`, `temp_SOIL`, `conduct_SOIL` |
| Milesight EM500-SMTC | `humidity`, `temperature`, `conductivity` |
| Seeed SenseCAP S2104/S2105 | `messages[]` with `measurementId` 4102 (temp), 4103 (VWC), 4108 (EC) |
| Decentlab DL-TRS12 | `volumetric_water_content` (fraction, converted), `soil_temperature`, `electrical_conductivity` |
| anything else | set `mapping` on the device: `{"vwc":"myMoistureField","tempC":"myTempField","ec":"myEcField"}` |

If nothing is recognised the webhook answers `422` with the list of keys it saw, so you know what to map. The Things Stack retries failed deliveries.

## ChirpStack, Helium, KPN Things

Any network server that can POST JSON works. Send either the TTN-shaped uplink (`end_device_ids.dev_eui` + `uplink_message.decoded_payload`) to `/ingest/ttn`, or transform to the direct soil format and post to `/ingest/soil`. A 20-line Node-RED flow is enough; contributions of ready-made flows are welcome in `clients/`.

## Rate limits and sizes

None enforced in v0.1 beyond request size (5,000 rows). Be kind: batch. The fair thing for a recorder is one push per 10 minutes; for a probe, one uplink per 20 to 30 minutes.

## Verifying that data arrived

`GET /api/v1/places/<slug>/devices` shows `lastSeenAt` per device. `GET /api/v1/places/<slug>` shows counts. Readings recompute at least daily; `POST /api/v1/places/<slug>/readings` with your steward key recomputes now.
