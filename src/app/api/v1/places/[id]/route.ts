import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, canManagePlace, json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { verdict, type ReadingOut } from "@/lib/readings";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const [devices, readings, sat, jobs, visits] = await Promise.all([
    prisma.device.findMany({ where: { placeId: place.id }, select: { id: true, kind: true, model: true, lat: true, lon: true, installedAt: true, lastSeenAt: true, depthCm: true, heightM: true } }),
    prisma.reading.findMany({ where: { placeId: place.id }, orderBy: { computedAt: "desc" } }),
    prisma.satelliteObs.findMany({ where: { placeId: place.id }, orderBy: { date: "asc" }, select: { date: true, ndviMean: true, ndviP10: true, ndviP90: true, validFraction: true, cloudCover: true, sceneId: true } }),
    prisma.job.findMany({ where: { placeId: place.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.visit.findMany({ where: { placeId: place.id }, orderBy: { date: "desc" }, take: 20 }),
  ]);
  const periods = [...new Set(readings.map((r) => r.period))].sort().reverse();
  const latest = readings.filter((r) => r.period === periods[0]);
  const list: ReadingOut[] = latest.map((r) => ({ dimension: r.dimension, direction: r.direction, confidence: r.confidence, maturity: r.maturity, evidence: (r.evidence as Record<string, unknown>) ?? {} }));
  return json({ place, devices, readings: latest, period: periods[0] ?? null, verdict: list.length === 7 ? verdict(list) : { verdict: "insufficient", reason: "not yet computed" }, satellite: sat, jobs, visits });
}

const Patch = z.object({ name: z.string().min(2).max(120).optional(), description: z.string().max(4000).optional(), biome: z.string().max(80).optional(), landUse: z.string().max(80).optional(), stewardName: z.string().max(120).optional(), stewardContact: z.string().max(200).optional(), public: z.boolean().optional() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const p = await authenticate(req);
  if (!canManagePlace(p, place.id)) return unauthorized();
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const updated = await prisma.place.update({ where: { id: place.id }, data: parsed.data });
  return json({ place: updated });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const p = await authenticate(req);
  if (!p || p.kind !== "admin") return unauthorized();
  await prisma.place.delete({ where: { id: place.id } });
  return json({ deleted: place.id });
}
