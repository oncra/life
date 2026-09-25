import { prisma } from "@/lib/db";
import { authenticate, canManagePlace, json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
export const dynamic = "force-dynamic";
/**
 * Acknowledge an alert (steward or admin). Resolving a MOVED alert re-homes the device to the cell it is on now:
 * that is the steward saying "yes, I moved it". A box that was taken is not acknowledged; it is reported.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; alertId: string }> }) {
  const { id, alertId } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const p = await authenticate(req);
  if (!canManagePlace(p, place.id)) return unauthorized();
  const alert = await prisma.alert.findFirst({ where: { id: alertId, device: { placeId: place.id } }, include: { device: { select: { id: true, cell: true } } } });
  if (!alert) return json({ error: "not found" }, 404);
  if (alert.resolvedAt) return json({ ok: true, alert, note: "already resolved" });
  const by = p!.kind === "admin" ? "admin" : p!.kind === "key" ? p!.name : "device";
  const updated = await prisma.alert.update({ where: { id: alert.id }, data: { resolvedAt: new Date(), resolvedBy: by } });
  let homeCell: unknown = undefined;
  if (alert.kind === "MOVED" && alert.device.cell) {
    const c = alert.device.cell as { plmn?: string; cellId?: string | number; tac?: string | number };
    homeCell = { plmn: c.plmn, cellId: c.cellId, tac: c.tac, since: new Date().toISOString(), rehomedBy: by };
    await prisma.device.update({ where: { id: alert.device.id }, data: { homeCell: homeCell as object } });
  }
  return json({ ok: true, alert: updated, homeCell });
}
