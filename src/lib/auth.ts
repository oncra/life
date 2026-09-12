import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import type { KeyRole } from "@/generated/prisma/client";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newKey(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) return m[1].trim();
  const x = req.headers.get("x-life-token");
  return x ? x.trim() : null;
}

export type Principal =
  | { kind: "admin" }
  | { kind: "key"; id: string; role: KeyRole; placeId: string | null; name: string }
  | { kind: "device"; id: string; placeId: string; deviceKind: string; model: string; mapping: unknown };

export async function authenticate(req: Request): Promise<Principal | null> {
  const key = bearer(req);
  if (!key) return null;
  const admin = process.env.ADMIN_API_KEY;
  if (admin && key.length >= 12 && hashKey(key) === hashKey(admin)) return { kind: "admin" };
  const h = hashKey(key);
  if (key.startsWith("lo_dev_")) {
    const d = await prisma.device.findUnique({ where: { tokenHash: h } });
    if (!d) return null;
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
    return { kind: "device", id: d.id, placeId: d.placeId, deviceKind: d.kind, model: d.model, mapping: d.mapping };
  }
  const k = await prisma.apiKey.findUnique({ where: { keyHash: h } });
  if (!k) return null;
  await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  return { kind: "key", id: k.id, role: k.role, placeId: k.placeId, name: k.name };
}

export function canManagePlace(p: Principal | null, placeId: string): boolean {
  if (!p) return false;
  if (p.kind === "admin") return true;
  if (p.kind === "key") return p.role === "ADMIN" || (p.role === "STEWARD" && (p.placeId === null || p.placeId === placeId));
  return false;
}

export function canCreatePlace(p: Principal | null): boolean {
  if (!p) return false;
  if (p.kind === "admin") return true;
  return p.kind === "key" && (p.role === "ADMIN" || p.role === "STEWARD");
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export const unauthorized = () => json({ error: "unauthorized" }, 401);
export const forbidden = () => json({ error: "forbidden" }, 403);
