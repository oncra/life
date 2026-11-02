import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { json } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canSeeExact } from "@/lib/privacy";
import { clipPath } from "@/lib/clips";
import { zipStream, type ZipFile } from "@/lib/zip";
export const dynamic = "force-dynamic";

// The clips of a place whose sound the oracle still has, as one zip: every clip and a clips.csv with its facts and
// the verdicts on it (species, score, time, band, microphone, timing in the clip). ?month=2026-05 for one month (UTC),
// ?device= for one node. For whoever may see the place exactly: anyone may listen to a clip on the triage page, but a
// place's clips together, with their times, belong to those who know where it is.

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place || !(await canSeeExact(place, req))) return json({ error: "not found" }, 404);
  const q = new URL(req.url).searchParams;
  const month = q.get("month");
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "month is YYYY-MM" }, 400);
  const from = month ? new Date(`${month}-01T00:00:00Z`) : null;
  const to = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)) : null;
  const clips = await prisma.clip.findMany({
    where: { device: { placeId: place.id }, file: { not: null }, ...(q.get("device") ? { deviceId: q.get("device")! } : {}), ...(from && to ? { ts: { gte: from, lt: to } } : {}) },
    orderBy: { ts: "asc" },
    select: {
      deviceId: true, detectionRef: true, ts: true, scientific: true, species: true, confidence: true, band: true, detector: true, source: true,
      clipS: true, fromS: true, toS: true, expansion: true, gainDb: true, sha256: true, file: true, reviews: { select: { verdict: true } },
    },
  });
  if (!clips.length) return json({ error: month ? `no clips with sound in ${month}` : "no clips with sound" }, 404);
  const header = ["file", "detection", "time_utc", "scientific", "species", "score", "band", "detector", "source", "clip_s", "detection_from_s", "detection_to_s", "expansion", "gain_db", "sha256", "device", "right", "wrong", "unsure"];
  async function* files(): AsyncGenerator<ZipFile> {
    const rows = [header.join(",")];
    const used = new Set<string>();
    for (const c of clips) {
      const stamp = c.ts.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      const base = `${stamp}Z_${c.scientific.replace(/[^A-Za-z0-9]+/g, "_")}_${c.band ?? "x"}`;
      let name = `${base}${path.extname(c.file!)}`;
      for (let k = 2; used.has(name); k++) name = `${base}_${k}${path.extname(c.file!)}`;
      const data = await readFile(clipPath(c.file!)).catch(() => null);
      if (!data) continue;
      used.add(name);
      const count = (v: string) => c.reviews.filter((r) => r.verdict === v).length;
      rows.push([name, c.detectionRef, c.ts, c.scientific, c.species, c.confidence, c.band, c.detector, c.source, c.clipS, c.fromS, c.toS, c.expansion, c.gainDb, c.sha256, c.deviceId, count("right"), count("wrong"), count("unsure")].map(csvCell).join(","));
      yield { name: `clips/${name}`, time: c.ts, data: async () => data };
    }
    const csv = Buffer.from(rows.join("\n") + "\n", "utf8");
    yield { name: "clips.csv", time: new Date(), data: async () => csv };
  }
  return new Response(zipStream(files()), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${place.slug}-clips-${month ?? "all"}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
