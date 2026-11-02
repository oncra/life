import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canManage } from "@/lib/privacy";
import { ConfigBody, configState, nextConfig } from "@/lib/node-config";
export const dynamic = "force-dynamic";

/**
 * A node's settings over the air (src/lib/node-config.ts): a short list of its own settings within fixed bounds, sent
 * with the method's listening windows. GET shows them with those windows, today's times at the place, and whether the
 * node has them, refused them or is trying them, as its last heartbeat said. PUT {env?, again?}: a value in env sets
 * that setting and null gives it back to the node, again sends the same settings once more under a new rev. The node
 * gets them with its next heartbeat answer and checks them again itself. A managing key, or the place's owner signed in.
 */
async function guard(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }): Promise<Response | { deviceId: string; by: string; config: unknown }> {
  const { id, deviceId } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const who = await canManage(place, req);
  if (!who) return unauthorized();
  const device = await prisma.device.findFirst({ where: { id: deviceId, placeId: place.id }, select: { id: true, config: true } });
  if (!device) return json({ error: "device not found" }, 404);
  return { deviceId: device.id, by: who.by, config: device.config };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if (g instanceof Response) return g;
  return json(await configState(g.deviceId), 200, { "cache-control": "no-store" });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; deviceId: string }> }) {
  const g = await guard(req, ctx);
  if (g instanceof Response) return g;
  const parsed = ConfigBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  if (parsed.data.env === undefined && !parsed.data.again) return json({ error: "send env or again" }, 400);
  const next = nextConfig(g.config, parsed.data);
  if (!next.ok) return json({ error: next.why }, 400);
  await prisma.device.update({ where: { id: g.deviceId }, data: { config: next.config as object, configN: { increment: 1 }, configAt: new Date(), configBy: g.by }, select: { id: true } });
  return json({ ...(await configState(g.deviceId)), note: "The node gets these with its next heartbeat answer while it is awake, checks them itself, and goes back to its last good settings if it hears nothing from the oracle in three wakes." }, 200, { "cache-control": "no-store" });
}
