import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
export const dynamic = "force-dynamic";
const Body = z.object({ date: z.string().datetime(), kind: z.enum(["BASELINE", "RANDOM", "TRIGGERED"]), verifier: z.string().max(120).optional(), findings: z.record(z.string(), z.unknown()).optional(), notes: z.string().max(8000).optional() });
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  return json({ place: place.slug, items: await prisma.visit.findMany({ where: { placeId: place.id }, orderBy: { date: "desc" } }) });
}
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const p = await authenticate(req);
  const ok = p && (p.kind === "admin" || (p.kind === "key" && (p.role === "VERIFIER" || p.role === "ADMIN")));
  if (!ok) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const v = await prisma.visit.create({ data: { placeId: place.id, date: new Date(parsed.data.date), kind: parsed.data.kind, verifier: parsed.data.verifier ?? (p.kind === "key" ? p.name : "admin"), findings: parsed.data.findings as object | undefined, notes: parsed.data.notes } });
  return json({ visit: v }, 201);
}
