import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, canManagePlace, json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { maintenanceOut } from "@/lib/alerts";
export const dynamic = "force-dynamic";

/**
 * The steward's maintenance window: "I will open this box between from and until". The node hears it on its
 * next heartbeat (or on the alarm boot when the lid opens) and silences its tamper guard for the window.
 * PUT {hours} for a window starting now, or {from, until}. DELETE clears it.
 */
const Body = z.union([
  z.object({ hours: z.number().min(0.25).max(72) }),
  z.object({ from: z.string().datetime({ offset: true }).optional(), until: z.string().datetime({ offset: true }) }),
]);

async function guard(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const { id, deviceId } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return { err: json({ error: "not found" }, 404) };
  const p = await authenticate(req);
  if (!canManagePlace(p, place.id)) return { err: unauthorized() };
  const device = await prisma.device.findFirst({ where: { id: deviceId, placeId: place.id } });
  if (!device) return { err: json({ error: "device not found" }, 404) };
  return { device, by: p!.kind === "admin" ? "admin" : p!.kind === "key" ? p!.name : "device" };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if ("err" in g) return g.err;
  return json({ device: g.device.id, maintenance: maintenanceOut(g.device) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if ("err" in g) return g.err;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const b = parsed.data;
  const from = "hours" in b ? new Date() : b.from ? new Date(b.from) : new Date();
  const until = "hours" in b ? new Date(Date.now() + b.hours * 3600e3) : new Date(b.until);
  if (until <= from) return json({ error: "until must be after from" }, 400);
  if (until.getTime() - from.getTime() > 72 * 3600e3) return json({ error: "a window is at most 72 h; set another one later" }, 400);
  const d = await prisma.device.update({ where: { id: g.device.id }, data: { maintenanceFrom: from, maintenanceUntil: until } });
  return json({ device: d.id, maintenance: maintenanceOut(d), by: g.by, note: "The node learns of it on its next heartbeat, or on the alarm boot when the lid opens. Windows set a day ahead mean no chirp at all." });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if ("err" in g) return g.err;
  await prisma.device.update({ where: { id: g.device.id }, data: { maintenanceFrom: null, maintenanceUntil: null } });
  return json({ device: g.device.id, maintenance: null });
}
