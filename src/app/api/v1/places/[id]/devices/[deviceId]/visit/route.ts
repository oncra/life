import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canManage } from "@/lib/privacy";
import { newApPsk, VisitBody, visitState } from "@/lib/node-visit";
export const dynamic = "force-dynamic";

/**
 * A node's visit settings (src/lib/node-visit.ts): the phone hotspot it joins on a visit and the password of its own
 * WiFi for a laptop. GET shows them with whether the node has them yet and its clips as its last heartbeat said. PUT
 * {ssid?, psk?, apPsk?}: a value sets it, null puts the default back (for apPsk: draws a new password). The node
 * hears a change with its next heartbeat answer. A managing key, or the place's owner signed in.
 */
async function guard(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }): Promise<Response | { deviceId: string }> {
  const { id, deviceId } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  if (!(await canManage(place, req))) return unauthorized();
  const device = await prisma.device.findFirst({ where: { id: deviceId, placeId: place.id }, select: { id: true } });
  if (!device) return json({ error: "device not found" }, 404);
  return { deviceId: device.id };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if (g instanceof Response) return g;
  return json(await visitState(g.deviceId), 200, { "cache-control": "no-store" });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if (g instanceof Response) return g;
  const parsed = VisitBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const b = parsed.data;
  const data: { visitSsid?: string | null; visitPsk?: string | null; visitApPsk?: string; visitRev: { increment: number } } = { visitRev: { increment: 1 } };
  if (b.ssid !== undefined) data.visitSsid = b.ssid;
  if (b.psk !== undefined) data.visitPsk = b.psk;
  if (b.apPsk !== undefined) data.visitApPsk = b.apPsk ?? newApPsk();
  if (Object.keys(data).length === 1) return json({ error: "send ssid, psk or apPsk" }, 400);
  await prisma.device.update({ where: { id: g.deviceId }, data, select: { id: true } });
  return json({ ...(await visitState(g.deviceId)), note: "The node gets these with its next heartbeat answer, within the hour while it is awake." }, 200, { "cache-control": "no-store" });
}
