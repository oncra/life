import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, canManagePlace, json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { normalizeEmail } from "@/lib/session";

export const dynamic = "force-dynamic";

// Who may see this place exactly and follow it, besides Life Box owners. Admin or the place's steward key.
// The person signs in at /me with a code sent to this address; nothing is mailed when access is given.

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  if (!canManagePlace(await authenticate(req), place.id)) return unauthorized();
  const rows = await prisma.placeAccess.findMany({ where: { placeId: place.id }, include: { user: { select: { email: true, lastLogin: true } } }, orderBy: { createdAt: "asc" } });
  return json({ place: place.slug, items: rows.map((r) => ({ email: r.user.email, role: r.role, since: r.createdAt, lastLogin: r.user.lastLogin })) });
}

const Body = z.object({ email: z.string().email().max(200), role: z.enum(["owner", "viewer"]).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  if (!canManagePlace(await authenticate(req), place.id)) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.upsert({ where: { email }, create: { email }, update: {} });
  const row = await prisma.placeAccess.upsert({
    where: { userId_placeId: { userId: user.id, placeId: place.id } },
    create: { userId: user.id, placeId: place.id, role: parsed.data.role ?? "owner" },
    update: { role: parsed.data.role ?? "owner" },
  });
  return json({ place: place.slug, email, role: row.role, signIn: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://life.oncra.org"}/me` }, 201);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  if (!canManagePlace(await authenticate(req), place.id)) return unauthorized();
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return json({ error: "email required" }, 400);
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  const n = user ? (await prisma.placeAccess.deleteMany({ where: { userId: user.id, placeId: place.id } })).count : 0;
  return json({ removed: n });
}
