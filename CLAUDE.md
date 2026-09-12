# life (oncra/life) — repo rules

- Public, open-source repo under the `oncra` GitHub organisation. **No AI attribution in commits, PRs, code comments or docs** (Oncra house rule). Externally the author is the project; do not write "Claude" or "Diane" anywhere in this repo.
- Code is Apache-2.0, `content/` is CC BY 4.0. Keep licence headers consistent.
- Method rule: a change to `src/lib/readings.ts` must come with the matching change in `content/spec.md`.
- Never a weighted sum across readings; `UNKNOWN` must carry a note.
- Prisma 7: migrations are hand-reviewed SQL in `prisma/migrations`; the app runs `prisma migrate deploy` on start. No `prisma db push` against a shared database.
- Hardware prices in `content/hardware.md` carry a check date and URL.
- Deploy: `ssh admin@<host> 'bash -s' < deploy/deploy.sh` (clones/updates `/opt/life`, builds, `docker compose up -d`). Verify `https://life.oncra.org/api/health` afterwards.
