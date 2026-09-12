import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, canCreatePlace, hashKey, json, newKey, unauthorized } from "@/lib/auth";
import { normalizeGeometry, slugify, summarize } from "@/lib/geo";
import { queueJob, uniqueSlug } from "@/lib/places";
import { verdict, type ReadingOut } from "@/lib/readings";
import type { Dimension, Direction } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(4000).optional(),
  geometry: z.unknown(),
  country: z.string().max(2).optional(),
  biome: z.string().max(80).optional(),
  landUse: z.string().max(80).optional(),
  stewardName: z.string().max(120).optional(),
  stewardContact: z.string().max(200).optional(),
  public: z.boolean().optional(),
});

async function latestVerdicts(placeIds: string[]) {
  const rs = await prisma.reading.findMany({ where: { placeId: { in: placeIds } }, orderBy: { computedAt: "desc" } });
  const byPlace = new Map<string, Map<Dimension, { direction: Direction; confidence: number; maturity: number }>>();
  for (const r of rs) {
    const m = byPlace.get(r.placeId) ?? new Map();
    if (!m.has(r.dimension)) m.set(r.dimension, { direction: r.direction, confidence: r.confidence, maturity: r.maturity });
    byPlace.set(r.placeId, m);
  }
  const out = new Map<string, { verdict: string; reason: string }>();
  for (const [pid, m] of byPlace) {
    const list: ReadingOut[] = [...m.entries()].map(([dimension, v]) => ({ dimension, ...v, evidence: {} }));
    out.set(pid, list.length === 7 ? verdict(list) : { verdict: "insufficient", reason: "not yet computed" });
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const places = await prisma.place.findMany({ where: { public: true }, orderBy: { createdAt: "desc" }, include: { _count: { select: { devices: true, satellite: true } } } });
  const v = await latestVerdicts(places.map((p) => p.id));
  if (url.searchParams.get("format") === "geojson") {
    return json({
      type: "FeatureCollection",
      features: places.map((p) => ({
        type: "Feature",
        id: p.id,
        geometry: p.geometry,
        properties: { id: p.id, slug: p.slug, name: p.name, areaHa: p.areaHa, country: p.country, landUse: p.landUse, devices: p._count.devices, observations: p._count.satellite, verdict: v.get(p.id)?.verdict ?? "insufficient" },
      })),
    });
  }
  return json({ count: places.length, items: places.map((p) => ({ id: p.id, slug: p.slug, name: p.name, areaHa: p.areaHa, centroid: [p.centroidLon, p.centroidLat], country: p.country, landUse: p.landUse, devices: p._count.devices, observations: p._count.satellite, verdict: v.get(p.id) ?? { verdict: "insufficient", reason: "not yet computed" }, createdAt: p.createdAt })) });
}

export async function POST(req: Request) {
  const principal = await authenticate(req);
  if (!canCreatePlace(principal)) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  let geom;
  try { geom = normalizeGeometry(parsed.data.geometry); } catch (e) { return json({ error: String((e as Error).message) }, 400); }
  const s = summarize(geom);
  if (s.areaHa > 100_000) return json({ error: "place larger than 100,000 ha; split it" }, 400);
  const slug = await uniqueSlug(slugify(parsed.data.name));
  const place = await prisma.place.create({
    data: { ...parsed.data, geometry: geom as object, slug, areaHa: s.areaHa, centroidLat: s.centroidLat, centroidLon: s.centroidLon },
  });
  const stewardKey = newKey("lo_key");
  await prisma.apiKey.create({ data: { name: `steward:${place.slug}`, role: "STEWARD", keyHash: hashKey(stewardKey), placeId: place.id } });
  await queueJob("satellite.backfill", place.id);
  return json({ place, stewardKey, note: "Store the steward key now; it is not shown again. Satellite backfill queued." }, 201);
}
