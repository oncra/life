import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "./db";
import { authenticate, hashKey } from "./auth";
import { currentUser } from "./session";
import type { BacklogLane, Prisma } from "@/generated/prisma/client";

// The build backlog (/backlog): a kanban of ideas met while building. Everyone reads it. Changing it takes one of
// three things: the board password (BACKLOG_PASSWORD, kept in a cookie once typed), a sign-in, or the admin key.
export const LANES = ["BACKLOG", "NEXT", "DOING", "DONE"] as const satisfies readonly BacklogLane[];
export const BACKLOG_COOKIE = "life_backlog";
const COOKIE_DAYS = 180;

export type Editor = "key" | "session" | "password";

/** The cookie value that proves the password was typed. It changes with the password, so a new password locks everyone out. */
function unlockToken(): string | null {
  const pw = process.env.BACKLOG_PASSWORD;
  if (!pw) return null;
  return hashKey(`backlog:${process.env.ADMIN_API_KEY ?? ""}:${pw}`);
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(typed: string): boolean {
  const pw = process.env.BACKLOG_PASSWORD;
  return !!pw && same(hashKey(typed.trim()), hashKey(pw));
}

export async function setUnlockCookie() {
  const t = unlockToken();
  if (!t) return;
  (await cookies()).set(BACKLOG_COOKIE, t, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: COOKIE_DAYS * 86400 });
}

export async function clearUnlockCookie() {
  (await cookies()).delete(BACKLOG_COOKIE);
}

/** Who may change the board in this request, if anyone. */
export async function backlogEditor(req?: Request): Promise<Editor | null> {
  if (req?.headers.get("authorization") || req?.headers.get("x-life-token")) {
    const p = await authenticate(req);
    if (p && (p.kind === "admin" || (p.kind === "key" && p.role === "ADMIN"))) return "key";
  }
  if (await currentUser()) return "session";
  const want = unlockToken();
  const got = (await cookies()).get(BACKLOG_COOKIE)?.value;
  if (want && got && same(got, want)) return "password";
  return null;
}

// Wrong passwords per address, kept in memory: the app runs as one process, and a restart forgetting them is fine.
const misses = new Map<string, { n: number; until: number }>();
const MISS_LIMIT = 10;
const MISS_WINDOW = 15 * 60e3;

export function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export function tooManyMisses(key: string): boolean {
  const m = misses.get(key);
  return !!m && m.until > Date.now() && m.n >= MISS_LIMIT;
}

export function recordMiss(key: string) {
  const now = Date.now();
  const m = misses.get(key);
  misses.set(key, m && m.until > now ? { n: m.n + 1, until: m.until } : { n: 1, until: now + MISS_WINDOW });
  if (misses.size > 5000) for (const [k, v] of misses) if (v.until <= now) misses.delete(k);
}

export const cardSelect = { id: true, lane: true, rank: true, title: true, body: true, author: true, createdAt: true, updatedAt: true, doneAt: true } as const;

export async function listCards() {
  return prisma.backlogCard.findMany({ orderBy: [{ lane: "asc" }, { rank: "asc" }, { createdAt: "desc" }], select: cardSelect });
}

/** Where a card goes in its lane: on top, at the bottom, or right before / after another card in that lane. */
export const At = z.union([z.enum(["top", "bottom"]), z.object({ before: z.string().min(1) }), z.object({ after: z.string().min(1) })]);
export type AtT = z.infer<typeof At>;

/**
 * The rank that puts a card at `at` in `lane`, leaving the other cards where they are. When repeated halving has
 * left no room between two neighbours, the lane is numbered again first (its order kept).
 */
export async function rankFor(tx: Prisma.TransactionClient, lane: BacklogLane, at: AtT, self?: string): Promise<number> {
  const others = await tx.backlogCard.findMany({ where: { lane, ...(self ? { id: { not: self } } : {}) }, orderBy: [{ rank: "asc" }, { createdAt: "desc" }], select: { id: true, rank: true } });
  let i: number;
  if (at === "top") i = 0;
  else if (at === "bottom") i = others.length;
  else if ("before" in at) { const j = others.findIndex((o) => o.id === at.before); i = j < 0 ? 0 : j; }
  else { const j = others.findIndex((o) => o.id === at.after); i = j < 0 ? others.length : j + 1; }
  const prev = others[i - 1]?.rank;
  const next = others[i]?.rank;
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  if (next - prev > 1e-6) return (prev + next) / 2;
  await Promise.all(others.map((o, k) => tx.backlogCard.update({ where: { id: o.id }, data: { rank: k < i ? k : k + 1 } })));
  return i;
}
