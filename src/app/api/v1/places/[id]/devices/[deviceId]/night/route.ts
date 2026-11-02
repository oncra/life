import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canManage } from "@/lib/privacy";
import { NightBody, nightState } from "@/lib/node-night";
export const dynamic = "force-dynamic";

/**
 * A node's meadow-bird window (src/lib/node-night.ts): an hour or so after the dusk window in spring, off until the
 * owner turns it on, never counted by the readings. GET shows the settings with whether the node has them yet, the next
 * window and how the last one went. PUT {on?, startMin?, lenMin?, from?, to?, battery?, minV?}: a value sets it. The
 * node hears a change with its next heartbeat answer. A managing key, or the place's owner signed in.
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
  return json(await nightState(g.deviceId), 200, { "cache-control": "no-store" });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if (g instanceof Response) return g;
  const parsed = NightBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const b = parsed.data;
  const data: { nightOn?: boolean; nightStartMin?: number; nightLenMin?: number; nightFrom?: string; nightTo?: string; nightBattery?: boolean; nightMinV?: number } = {};
  if (b.on !== undefined) data.nightOn = b.on;
  if (b.startMin !== undefined) data.nightStartMin = b.startMin;
  if (b.lenMin !== undefined) data.nightLenMin = b.lenMin;
  if (b.from !== undefined) data.nightFrom = b.from;
  if (b.to !== undefined) data.nightTo = b.to;
  if (b.battery !== undefined) data.nightBattery = b.battery;
  if (b.minV !== undefined) data.nightMinV = Math.round(b.minV * 10) / 10;
  if (!Object.keys(data).length) return json({ error: "send on, startMin, lenMin, from, to, battery or minV" }, 400);
  await prisma.device.update({ where: { id: g.deviceId }, data: { ...data, nightRev: { increment: 1 } }, select: { id: true } });
  return json({ ...(await nightState(g.deviceId)), note: "The node gets these with its next heartbeat answer while it is awake, and keeps them for its next windows." }, 200, { "cache-control": "no-store" });
}
