import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

// A laptop at a visit takes clips from the node over the node's own WiFi, and the node signs them over to it: a grant,
// lg1.<payload>.<signature>, for exactly those clips (node/life-clips.py `grant`). The payload names the node's device
// id (d), the batch (b), how many clips (n), their fingerprint (h) and when the grant runs out (e, seconds). It is
// signed with HMAC-SHA256 under the SHA-256 of the node's token, which is all the oracle keeps of the token, so the
// token itself never leaves the node and a laptop can send these clips and nothing else.

export type Grant = { deviceId: string; batch: string; n: number; hash: string; expiresAt: Date };
export type Item = { ref: string; sha256: string };

export const MAX_BATCH = 5000;
const SHA = /^[0-9a-f]{64}$/;

/** The batch's fingerprint, the same as on the node: SHA-256 over "ref sha256\n" per clip, sorted by ref. */
export function itemsHash(items: Item[]): string {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...items].sort((a, b) => cmp(a.ref, b.ref) || cmp(a.sha256, b.sha256));
  return createHash("sha256").update(sorted.map((i) => `${i.ref} ${i.sha256}\n`).join("")).digest("hex");
}

export function validItems(items: unknown): items is Item[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) return false;
  const seen = new Set<string>();
  for (const i of items) {
    if (!i || typeof i !== "object") return false;
    const { ref, sha256 } = i as Record<string, unknown>;
    if (typeof ref !== "string" || !ref || ref.length > 120 || /\s/.test(ref) || typeof sha256 !== "string" || !SHA.test(sha256) || seen.has(ref)) return false;
    seen.add(ref);
  }
  return true;
}

/** The grant's fields if it is well formed, before the signature is checked. */
export function readGrant(s: string): { payload: string; sig: Buffer; grant: Grant } | null {
  const m = /^lg1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(s.trim());
  if (!m) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { v, d, b, n, h, e } = p ?? {};
  if (v !== 1 || typeof d !== "string" || !d || d.length > 64 || typeof b !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(b)) return null;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_BATCH || typeof h !== "string" || !SHA.test(h) || typeof e !== "number" || !Number.isFinite(e)) return null;
  return { payload: m[1], sig: Buffer.from(m[2], "base64url"), grant: { deviceId: d, batch: b, n, hash: h, expiresAt: new Date(e * 1000) } };
}

/** Whether the grant was signed by the holder of the token whose SHA-256 is tokenHash. */
export function signedBy(payload: string, sig: Buffer, tokenHash: string): boolean {
  const want = createHmac("sha256", Buffer.from(tokenHash, "utf8")).update(payload, "utf8").digest();
  return sig.length === want.length && timingSafeEqual(sig, want);
}

/** The grant in `Authorization: Grant lg1...`, checked against the node's token and the clock. */
export async function grantOf(req: Request, now = new Date()): Promise<{ grant: Grant } | { error: string; status: number } | null> {
  const m = /^Grant\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const g = readGrant(m[1]);
  if (!g) return { error: "the grant is not one a node makes", status: 401 };
  const d = await prisma.device.findUnique({ where: { id: g.grant.deviceId }, select: { tokenHash: true } });
  if (!d || !signedBy(g.payload, g.sig, d.tokenHash)) return { error: "the grant is not signed by this node", status: 401 };
  if (g.grant.expiresAt <= now) return { error: "the grant has run out: take the clips from the node again", status: 401 };
  return { grant: g.grant };
}

/** The refs of these items the oracle has, each with the same SHA-256. */
export async function itemsHeld(deviceId: string, items: Item[]): Promise<string[]> {
  if (!items.length) return [];
  const rows = await prisma.$queryRaw<{ ref: string }[]>`
    select c."detectionRef" as ref from unnest(${items.map((i) => i.ref)}::text[], ${items.map((i) => i.sha256)}::text[]) as i(ref, sha)
    join "Clip" c on c."deviceId" = ${deviceId} and c."detectionRef" = i.ref and c."sha256" = i.sha`;
  return rows.map((r) => r.ref);
}

/** Whether a clip is one the node listed in the batch, with this SHA-256. */
export async function inBatch(deviceId: string, batch: string, item: Item): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from "ClipBatch" where "deviceId" = ${deviceId} and "batch" = ${batch} and "expiresAt" > now()
    and "items" @> ${JSON.stringify([{ ref: item.ref, sha256: item.sha256 }])}::jsonb`;
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Which of the batches a node reports it handed to a laptop (heartbeat `clipsHanded`, "batch:clips,...") the oracle
 * now has every clip of, each with the SHA-256 the node listed. A batch found complete stays complete; the node
 * deletes its copies when it hears so.
 */
export async function batchesReceived(deviceId: string, handed: string, now = new Date()): Promise<string[]> {
  const asked = [...new Set(handed.split(",").map((s) => s.split(":")[0].trim()).filter((b) => /^[A-Za-z0-9_-]{4,64}$/.test(b)))].slice(0, 40);
  if (!asked.length) return [];
  const rows = await prisma.clipBatch.findMany({ where: { deviceId, batch: { in: asked } }, select: { id: true, batch: true, n: true, completeAt: true } });
  const out: string[] = [];
  for (const r of rows) {
    if (r.completeAt) { out.push(r.batch); continue; }
    const [c] = await prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from "ClipBatch" b cross join lateral jsonb_to_recordset(b."items") as i(ref text, sha256 text)
      join "Clip" c on c."deviceId" = b."deviceId" and c."detectionRef" = i.ref and c."sha256" = i.sha256
      where b."id" = ${r.id}`;
    if ((c?.n ?? 0) >= r.n) {
      await prisma.clipBatch.update({ where: { id: r.id }, data: { completeAt: now } });
      out.push(r.batch);
    }
  }
  return out;
}
