---
title: Steward guide: from zero to seven readings
summary: Register a place, watch the satellite readings arrive, add a recorder and a probe, deliver the data. Step by step, with the exact commands.
order: 4
---

# Steward guide

A steward is whoever answers for a place: farmer, land manager, nature organisation, municipality, a group of neighbours. This guide takes you from nothing to a place with all three streams.

## Step 0: get a key

During the pilot, keys are handed out by the operator of this instance: mail [sven@climatecleanup.org](mailto:sven@climatecleanup.org) with the name of your place and where it is. Or run your own instance (see [Contributing](/docs/contributing)): the admin key in your `.env` can create steward keys:

```bash
curl -X POST https://life.oncra.org/api/v1/keys \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"name":"Marieke, Polder X","role":"STEWARD"}'
```

## Step 1: register the place (five minutes, satellite stream starts now)

In the browser: [Register a place](/places/new), click the boundary on the map, name it, paste your key. Or by API, with a GeoJSON polygon (WGS84, longitude first):

```bash
curl -X POST https://life.oncra.org/api/v1/places \
  -H "Authorization: Bearer lo_key_…" -H "content-type: application/json" \
  -d '{
    "name": "Achterste weiland",
    "landUse": "grassland",
    "country": "NL",
    "geometry": {"type":"Polygon","coordinates":[[[5.0500,52.0500],[5.0560,52.0500],[5.0560,52.0535],[5.0500,52.0535],[5.0500,52.0500]]]}
  }'
```

The answer contains the place, a **steward key scoped to this place** (shown once) and a note that the satellite backfill is queued. Seven years of Sentinel-2 are read in the background; a 5 ha field takes five to ten minutes. Open `/places/<slug>`: the NDVI chart fills in, and the **Productivity** and **Resilience** readings appear once three growing seasons and two drought years are in.

## Step 2: put up a sound recorder

Choose a kit from the [hardware guide](/docs/hardware). Register the device first so you have its token:

```bash
curl -X POST https://life.oncra.org/api/v1/places/<slug>/devices \
  -H "Authorization: Bearer lo_key_…" -H "content-type: application/json" \
  -d '{"kind":"SOUND","model":"BirdWeather PUC","lat":52.0518,"lon":5.0531,"heightM":1.8,"installedAt":"2026-09-20T09:00:00Z"}'
```

Keep the `deviceToken` (`lo_dev_…`). Then install per the [sound installation protocol](/docs/install-sound) and deliver data per the [data protocols](/docs/data-protocols): a BirdNET-Pi pushes every ten minutes with the client script; an AudioMoth card is analysed on your laptop and pushed in one go; a BirdWeather PUC is polled by the operator if you give them your station id.

## Step 3: sink a soil probe

Register it with its LoRaWAN DevEUI so the webhook can match uplinks:

```bash
curl -X POST https://life.oncra.org/api/v1/places/<slug>/devices \
  -H "Authorization: Bearer lo_key_…" -H "content-type: application/json" \
  -d '{"kind":"SOIL","model":"Dragino SE01-LB","devEui":"A84041000181C2F1","lat":52.0515,"lon":5.0525,"depthCm":10,"installedAt":"2026-09-20T10:00:00Z"}'
```

Install per the [soil installation protocol](/docs/install-soil). In The Things Stack, add a webhook (see [data protocols](/docs/data-protocols)). The first uplink appears under Devices as "last seen" within the hour.

## Step 4: read the place

- `/places/<slug>`: the seven readings, the verdict, the chart.
- `/api/v1/places/<slug>`: everything as JSON, for your own spreadsheet or your agent.
- `/api/v1/places/<slug>/satellite?format=csv`: the raw NDVI series.

Readings for the sound and soil streams say **unknown** until a second year exists. That is by design: a direction needs two points. Productivity and Resilience come from the archive and need no waiting.

## Step 5: keep it alive

- Offline recorders: swap cards and batteries every 6 to 8 weeks (the AudioMoth configuration app tells you the exact mAh per day of your schedule).
- Connected recorders: a monthly look at the dashboard; clear cobwebs off the microphone.
- Probes: nothing for years. If "last seen" goes stale, the gateway or the network is usually the cause, not the probe.
- Mark the probe position for anyone with machinery.

## What you get in return

A public, reproducible record that life on your land is doing what you say it is doing, readable by the people who fund, buy, insure or regulate you, and by their software. And a lighter carbon-verification burden when the life readings and the carbon claim agree (see the [green paper](/docs/greenpaper)).
