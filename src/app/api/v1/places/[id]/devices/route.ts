import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, canManagePlace, hashKey, json, newKey, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["SOUND", "SOIL", "CAMERA", "OTHER"]),
  model: z.string().min(2).max(120),
  serial: z.string().max(120).optional(),
  devEui: z.string().regex(/^[0-9A-Fa-f]{16}$/).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  heightM: z.number().min(0).max(50).optional(),
  depthCm: z.number().int().min(0).max(300).optional(),
  installedAt: z.string().datetime().optional(),
  mapping: z.record(z.string(), z.string()).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const devices = await prisma.device.findMany({ where: { placeId: place.id }, select: { id: true, kind: true, model: true, serial: true, devEui: true, lat: true, lon: true, heightM: true, depthCm: true, installedAt: true, lastSeenAt: true, notes: true } });
  return json({ place: place.slug, items: devices });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const p = await authenticate(req);
  if (!canManagePlace(p, place.id)) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const token = newKey("lo_dev");
  const d = parsed.data;
  const device = await prisma.device.create({
    data: { placeId: place.id, kind: d.kind, model: d.model, serial: d.serial, devEui: d.devEui?.toUpperCase(), lat: d.lat, lon: d.lon, heightM: d.heightM, depthCm: d.depthCm, installedAt: d.installedAt ? new Date(d.installedAt) : undefined, mapping: d.mapping, notes: d.notes, tokenHash: hashKey(token) },
  });
  return json({ device: { id: device.id, kind: device.kind, model: device.model, devEui: device.devEui }, deviceToken: token, note: "Store the device token now; it is not shown again. Use it as `Authorization: Bearer <token>` on /api/v1/ingest/*." }, 201);
}
