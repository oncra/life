import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, hashKey, json, newKey, unauthorized } from "@/lib/auth";
export const dynamic = "force-dynamic";
const Body = z.object({ name: z.string().min(2).max(120), role: z.enum(["ADMIN", "STEWARD", "VERIFIER", "CONSUMER"]), placeId: z.string().optional() });
export async function POST(req: Request) {
  const p = await authenticate(req);
  if (!p || (p.kind !== "admin" && !(p.kind === "key" && p.role === "ADMIN"))) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const key = newKey("lo_key");
  const row = await prisma.apiKey.create({ data: { name: parsed.data.name, role: parsed.data.role, placeId: parsed.data.placeId, keyHash: hashKey(key) } });
  return json({ id: row.id, name: row.name, role: row.role, placeId: row.placeId, key, note: "Shown once." }, 201);
}
export async function GET(req: Request) {
  const p = await authenticate(req);
  if (!p || (p.kind !== "admin" && !(p.kind === "key" && p.role === "ADMIN"))) return unauthorized();
  return json({ items: await prisma.apiKey.findMany({ select: { id: true, name: true, role: true, placeId: true, createdAt: true, lastUsedAt: true } }) });
}
