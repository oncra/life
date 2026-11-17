import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canManage } from "@/lib/privacy";
export const dynamic = "force-dynamic";

/**
 * Whether this place's node dashboard is public (Place.nodePublic). Off while the node stands on someone's land: then
 * the dashboard, its status, the species the node heard, their clips and its dot on the maps are only for those who
 * may see the place exactly, and everyone else gets the 404 a private place gives (`canSeeNode` in src/lib/privacy.ts).
 * One switch per place, whatever the number of nodes on it. GET shows it, PUT {public} sets it. A managing key, or the
 * place's owner signed in (the switch in the owner's panel on the dashboard).
 */
const Body = z.object({ public: z.boolean() });

async function guard(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response | { id: string; slug: string; nodePublic: boolean }> {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  if (!(await canManage(place, req))) return unauthorized();
  return place;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, ctx);
  if (g instanceof Response) return g;
  return json({ place: g.slug, public: g.nodePublic }, 200, { "cache-control": "no-store" });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, ctx);
  if (g instanceof Response) return g;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const p = await prisma.place.update({ where: { id: g.id }, data: { nodePublic: parsed.data.public }, select: { slug: true, nodePublic: true } });
  return json({ place: p.slug, public: p.nodePublic }, 200, { "cache-control": "no-store" });
}
