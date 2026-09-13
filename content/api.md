---
title: "API"
summary: "Endpoints, authentication, and examples for reading verdicts and delivering data. Machine-readable spec at /api/v1/openapi.json."
order: 11
---

# API v1

Base URL `https://life.oncra.org/api/v1`. JSON in, JSON out. OpenAPI 3.1: [`/api/v1/openapi.json`](/api/v1/openapi.json).

## Authentication

`Authorization: Bearer <key>`. Three kinds of bearer:

- **admin**: the operator's `ADMIN_API_KEY` or an `ADMIN` role key;
- **role keys** `lo_key_…` with role `STEWARD` (optionally scoped to one place), `VERIFIER`, `CONSUMER`;
- **device tokens** `lo_dev_…`, valid only for `/ingest/*` and only for that device.

Reading public places needs no key.

## Read

| Call | Returns |
| --- | --- |
| `GET /places` | all public places with latest verdict |
| `GET /places?format=geojson` | FeatureCollection for maps |
| `GET /places/{id or slug}` | place, seven readings for the latest period, verdict, satellite series, devices, visits, jobs |
| `GET /places/{id}/satellite[?format=csv]` | NDVI observations |
| `GET /places/{id}/carbon` | yearly net ecosystem carbon balance as a low/central/high range, and what is issuable at the lower bound ([method](/docs/carbon)) |
| `GET /places/{id}/readings` | all readings, all periods |
| `GET /places/{id}/devices` | devices and last-seen |
| `GET /places/{id}/visits` | visits |
| `GET /api/health` | counts and time |

Example:

```bash
curl -s https://life.oncra.org/api/v1/places/achterste-weiland | jq '.verdict, [.readings[] | {dimension, direction, confidence, maturity}]'
```

## Write

| Call | Who | Does |
| --- | --- | --- |
| `POST /places` | steward, admin | register a place; returns a one-time steward key; queues the satellite backfill |
| `PATCH /places/{id}` | steward of that place, admin | update name, description, land use, visibility |
| `DELETE /places/{id}` | admin | delete |
| `POST /places/{id}/devices` | steward, admin | register a device; returns a one-time device token |
| `POST /places/{id}/readings` | steward, verifier, admin | recompute now |
| `POST /places/{id}/visits` | verifier, admin | file a visit |
| `POST /keys` | admin | create a role key |
| `POST /ingest/sound` | device | detections and indices |
| `POST /ingest/soil` | device | soil readings |
| `POST /ingest/ttn` | device, or steward/admin key + registered DevEUI | The Things Stack uplink webhook |

Full request shapes are in [data protocols](/docs/data-protocols) and the OpenAPI document.

## Reading object

```json
{
  "dimension": "PRODUCTIVITY",
  "direction": "RISING",
  "confidence": 0.76,
  "maturity": 2,
  "period": "2026-Q3",
  "evidence": { "lastSeason": {"year": 2026, "mean": 0.71, "n": 14}, "referenceMedian": 0.66, "delta": 0.05 }
}
```

`evidence` is always the numbers the direction came from. If you cannot reproduce a direction from its evidence and the [specification](/docs/spec), that is a bug; open an issue.

## Verdict object

```json
{ "verdict": "insufficient", "reason": "unknown: diversity, structure, renewal, cycling, autonomy" }
```

`thriving | holding | declining | insufficient`. Treat `insufficient` as "do not pay yet", not as "bad".

## Versioning

v0.1. Breaking changes will come as `/api/v2`; method changes come as a method version on each reading (specified).
