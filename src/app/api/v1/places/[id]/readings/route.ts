import { prisma } from "@/lib/db";
import { authenticate, canManagePlace, json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { computeReadings } from "@/lib/compute";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const rows = await prisma.reading.findMany({ where: { placeId: place.id }, orderBy: [{ period: "desc" }, { dimension: "asc" }] });
  return json({ place: place.slug, count: rows.length, items: rows });
}
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const p = await authenticate(req);
  if (!canManagePlace(p, place.id) && !(p?.kind === "key" && p.role === "VERIFIER")) return unauthorized();
  return json(await computeReadings(place.id));
}
