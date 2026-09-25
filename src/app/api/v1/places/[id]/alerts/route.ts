import { prisma } from "@/lib/db";
import { authenticate, canManagePlace, json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
export const dynamic = "force-dynamic";
/** Alerts on a place's devices, open first. Steward or admin: the detail carries cell ids, which say where a box went. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const p = await authenticate(req);
  if (!canManagePlace(p, place.id)) return unauthorized();
  const all = new URL(req.url).searchParams.get("all") === "1";
  const items = await prisma.alert.findMany({ where: { device: { placeId: place.id }, ...(all ? {} : { resolvedAt: null }) }, orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }], take: 200, include: { device: { select: { id: true, kind: true, model: true, lastHeartbeatAt: true, homeCell: true, cell: true } } } });
  return json({ place: place.slug, items });
}
