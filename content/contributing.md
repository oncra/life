---
title: "Contributing and running your own instance"
summary: "Repository layout, how to run the stack, how to propose a method change, and the house rules."
order: 11
---

# Contributing

Repository: [github.com/oncra/life](https://github.com/oncra/life). Code Apache-2.0, documents CC BY 4.0.

## Run it

Requirements: Docker with Compose, a host with 2 GB RAM, a domain pointing at it.

```bash
git clone https://github.com/oncra/life.git /opt/life && cd /opt/life
cp deploy/env.example .env   # set POSTGRES_PASSWORD, ADMIN_API_KEY, SITE_HOST, SITE_URL
docker compose up -d --build
docker compose logs -f worker   # watch the satellite backfill
```

Caddy obtains the TLS certificate. Migrations run on app start. The worker processes jobs and schedules satellite updates.

Development without Docker: Node 22, a Postgres 17 (`DATABASE_URL` in `.env`), then `npx prisma migrate deploy && npm run dev` and `npm run worker` in a second terminal.

## Layout

```
content/            the green paper, spec and guides (what you are reading)
prisma/             schema and hand-reviewed SQL migrations
src/lib/satellite.ts   Sentinel-2 NDVI from COGs
src/lib/readings.ts    the seven readings and the verdict (the method)
src/lib/ingest.ts      payload schemas and LoRaWAN decoder mapping
src/app/api/v1/        the API
src/components/        map and charts
scripts/worker.ts      background jobs
clients/               push scripts for BirdNET-Pi and AudioMoth cards
deploy/                Caddyfile, env example, deploy script
```

## Propose a method change

Open a pull request that changes `src/lib/readings.ts` and the matching section of `content/spec.md` together, with the evidence (a paper, a dataset, a comparison on existing places). Method changes are released as a new version; verdicts carry the version they were computed with (specified).

## House rules

- Measure behaviour, not inputs. A proposal that scores a management action rather than a living response does not belong in a reading.
- Never a weighted sum across readings.
- `UNKNOWN` is a valid return and must carry a note saying what is missing.
- Every direction must be reproducible from its `evidence` object.
- No raw audio, no personal data beyond a steward's chosen contact.
- Prices and product claims in the hardware guide carry a check date and a URL.

## Roadmap (from the specification's "specified" items)

1. Neighbour crowd: regional reference from public parcel registries (NL: BRP Gewaspercelen) and all registered places.
2. Server-side acoustic indices and a BirdWeather poller.
3. Visit scheduler with a public random beacon; disagreement detection.
4. Method versioning and the drift ledger.
5. Carbon coupling with the Oncra registry by API.
6. kNDVI, solar-day de-duplication, inward buffer, Landsat/HLS archive, Sentinel-1.
7. Magic-link login, organisations, per-place sharing.
