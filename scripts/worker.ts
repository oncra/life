/**
 * Background worker: satellite backfill/update and readings recompute.
 * Run with `npm run worker`. One process is enough for thousands of places; scale by running more.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { defaultFrom, ndviForScene, searchScenes } from "../src/lib/satellite";
import { computeReadings } from "../src/lib/compute";
import type { PlaceGeometry } from "../src/lib/geo";
import { pollBirdWeather } from "../src/lib/birdweather";
import { enrichPlaceContext } from "../src/lib/context";

const CONCURRENCY = Number(process.env.SAT_CONCURRENCY ?? 4);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function claim() {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status='running', "startedAt"=now(), attempts=attempts+1
    WHERE id = (SELECT id FROM "Job" WHERE status='queued' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  if (!rows.length) return null;
  return prisma.job.findUnique({ where: { id: rows[0].id } });
}

async function satellite(placeId: string, from: string) {
  const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
  const geom = place.geometry as unknown as PlaceGeometry;
  const to = new Date().toISOString().slice(0, 10);
  const items = await searchScenes(geom, from, to);
  const have = new Set((await prisma.satelliteObs.findMany({ where: { placeId }, select: { sceneId: true } })).map((s) => s.sceneId));
  const todo = items.filter((i) => !have.has(i.id));
  log(`place ${place.slug}: ${items.length} scenes, ${todo.length} new`);
  let stored = 0, skipped = 0, failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((it) => ndviForScene(it, geom)));
    for (let k = 0; k < results.length; k++) {
      const r = results[k];
      if (r.status === "rejected") { failed++; log(`  ${batch[k].id}: ${String(r.reason).slice(0, 160)}`); continue; }
      if (!r.value) { skipped++; continue; }
      await prisma.satelliteObs.upsert({
        where: { placeId_sceneId: { placeId, sceneId: r.value.sceneId } },
        create: { placeId, sceneId: r.value.sceneId, date: new Date(r.value.date), source: "sentinel-2-l2a", ndviMean: r.value.ndviMean, ndviP10: r.value.ndviP10, ndviP90: r.value.ndviP90, validFraction: r.value.validFraction, cloudCover: r.value.cloudCover, pixelCount: r.value.pixelCount },
        update: {},
      });
      stored++;
    }
  }
  log(`place ${place.slug}: stored ${stored}, cloudy/skipped ${skipped}, failed ${failed}`);
  await computeReadings(placeId);
  return { scenes: items.length, stored, skipped, failed };
}

async function runJob(job: { id: string; kind: string; placeId: string | null }) {
  try {
    if (job.kind === "satellite.backfill" && job.placeId) await satellite(job.placeId, defaultFrom());
    else if (job.kind === "satellite.update" && job.placeId) await satellite(job.placeId, new Date(Date.now() - 45 * 86400e3).toISOString().slice(0, 10));
    else if (job.kind === "readings.recompute" && job.placeId) await computeReadings(job.placeId);
    else if (job.kind === "context.enrich" && job.placeId) { const s = await enrichPlaceContext(job.placeId); log(`context ${job.placeId}: clay ${s.clayPct}% soc ${s.socPct}% pH ${s.ph} ${s.wrbClass ?? ""}`); }
    else throw new Error(`unknown job ${job.kind}`);
    await prisma.job.update({ where: { id: job.id }, data: { status: "done", finishedAt: new Date(), error: null } });
  } catch (e) {
    const msg = String((e as Error).stack ?? e).slice(0, 2000);
    log(`job ${job.id} failed: ${msg.split("\n")[0]}`);
    const j = await prisma.job.findUnique({ where: { id: job.id } });
    await prisma.job.update({ where: { id: job.id }, data: { status: (j?.attempts ?? 0) >= 3 ? "failed" : "queued", error: msg, finishedAt: new Date() } });
  }
}

let lastSchedule = 0, lastPoll = 0;
async function schedule() {
  const now = Date.now();
  if (now - lastPoll >= 3600e3) {
    lastPoll = now;
    await pollBirdWeather(log);
    for (const p of await prisma.place.findMany({ where: { devices: { some: { kind: "SOUND" } } }, select: { id: true } })) {
      const open = await prisma.job.findFirst({ where: { placeId: p.id, status: { in: ["queued", "running"] } } });
      if (!open) await prisma.job.create({ data: { kind: "readings.recompute", placeId: p.id } });
    }
  }
  if (now - lastSchedule < 6 * 3600e3) return;
  lastSchedule = now;
  const places = await prisma.place.findMany({ select: { id: true, context: true } });
  for (const p of places) {
    if (!p.context) { const open = await prisma.job.findFirst({ where: { placeId: p.id, kind: "context.enrich", status: { in: ["queued", "running"] } } }); if (!open) await prisma.job.create({ data: { kind: "context.enrich", placeId: p.id } }); }
    const open = await prisma.job.findFirst({ where: { placeId: p.id, kind: { in: ["satellite.update", "satellite.backfill"] }, status: { in: ["queued", "running"] } } });
    if (!open) await prisma.job.create({ data: { kind: "satellite.update", placeId: p.id } });
  }
  log(`scheduled updates for ${places.length} places`);
}

async function main() {
  log(`worker up, concurrency ${CONCURRENCY}`);
  // jobs left "running" by a previous worker process (restart, deploy) go back to the queue
  const reset = await prisma.job.updateMany({ where: { status: "running" }, data: { status: "queued" } });
  if (reset.count) log(`re-queued ${reset.count} interrupted job(s)`);
  for (;;) {
    try {
      await schedule();
      const job = await claim();
      if (job) { log(`job ${job.kind} ${job.placeId ?? ""}`); await runJob(job); continue; }
    } catch (e) { log("loop error", String(e).slice(0, 300)); }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
main();
