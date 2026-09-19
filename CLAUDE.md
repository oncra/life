# life (oncra/life) — repo rules

- Public, open-source repo under the `oncra` GitHub organisation. **No AI attribution in commits, PRs, code comments or docs** (Oncra house rule). Externally the author is the project; do not write "Claude" or "Diane" anywhere in this repo.
- Code is Apache-2.0, `content/` is CC BY 4.0. Keep licence headers consistent.
- Method rule: a change to `src/lib/readings.ts` must come with the matching change in `content/spec.md`.
- Never a weighted sum across readings; `UNKNOWN` must carry a note.
- Prisma 7: migrations are hand-reviewed SQL in `prisma/migrations`; the app runs `prisma migrate deploy` on start. No `prisma db push` against a shared database.
- Hardware prices in `content/hardware.md` carry a check date and URL.
- Deploy: `ssh admin@<host> 'bash -s' < deploy/deploy.sh` (clones/updates `/opt/life`, builds, `docker compose up -d`). Verify `https://life.oncra.org/api/health` afterwards.
- **Current pickup point**: the kit is `content/kit.md` (Life node v1, one solar 4G box, ~€687) with `kit/order-list.csv` and node software in `node/`. `kit/order-list.csv` is the source of truth for parts and prices; the table on the kit page describes it and must be changed with it.
- **Parts for node 1 were ordered on 2026-09-16**: Berrybase 1070372, reichelt I-653887, UUGear 14639, TelecomShop ORD546258919. Still to order: the Accuweb panel, the reichelt battery (available 2026-10-08), the 1NCE SIM, and the generic items. `node/provision.sh` has still never run on real hardware and the Modbus register maps are from datasheets, so the bench session is the next real step. Handoff: `~/code/sapience-os/briefs/2026-09-17-life-kit-handoff.md`.
- **The build order of work is `content/build.md`** (= /docs/build, five stages with a gate each), and `kit/bench-log.csv` is where the measured numbers go. Every energy figure on the kit page is still modelled; when a measurement contradicts one, the kit page changes.
