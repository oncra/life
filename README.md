# Life oracle

**Is life thriving here? Let the place answer.**

An open standard and open software for measuring whether life is thriving in a place, from three cheap streams: satellite, a sound recorder and a soil probe. Seven readings (productivity, diversity, structure, renewal, cycling, resilience, autonomy), one verdict (the weakest of the seven), no scheduled sampling. Built so that stewards, funders, verifiers and software agents can all check the same truth.

Reference instance: **https://life.oncra.org**

- [Green paper](content/greenpaper.md): why and how.
- [Specification](content/spec.md): the rules, with status (built / specified / open).
- [Hardware guide](content/hardware.md): what to buy, prices checked 2026-09-12.
- [Steward guide](content/guide-steward.md), [sound install](content/install-sound.md), [soil install](content/install-soil.md), [data protocols](content/data-protocols.md), [roles](content/roles.md), [API](content/api.md).

## Run your own

```bash
git clone https://github.com/oncra/life.git /opt/life && cd /opt/life
cp deploy/env.example .env    # POSTGRES_PASSWORD, ADMIN_API_KEY, SITE_HOST, SITE_URL
docker compose up -d --build
```

Stack: Next.js 16, Prisma 7, Postgres 17 (PostGIS image), Leaflet, geotiff.js; Caddy for TLS. The satellite stream reads Copernicus Sentinel-2 cloud-optimised GeoTIFFs straight from the public `sentinel-cogs` bucket through the Earth Search STAC API, no account needed.

## Licence

Code: Apache-2.0. Documents in `content/`: CC BY 4.0.

An Oncra / Climate Cleanup initiative.
