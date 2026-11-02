import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";

// A visit to a Life Node: someone stands at the box and the node lets its clips go (node/life-visit.py). It joins the
// visitor's phone hotspot and sends them to the oracle itself, or it opens its own WiFi for a laptop that takes them
// and sends them later with the node's grant (src/lib/grant.ts). The place's owner sets the hotspot's name and
// password and the password of the node's own WiFi on the node dashboard; the node hears them with its next heartbeat
// answer. Not the Visit model, which is a verifier's visit to the place.

/** What a node uses until its owner sets something else: a phone hotspot renamed "hotspot" with password 12345678
 * works at every node. The node's own WiFi gets a password of its own, drawn once (apPskFor). */
export const VISIT_DEFAULTS = { ssid: "hotspot", psk: "12345678" } as const;

/** The name of the node's own WiFi, the same on the node (life-visit): life- and the last six characters of its id. */
export function apSsid(deviceId: string): string {
  return `life-${deviceId.slice(-6)}`;
}

/** The months of a place's clips whose sound the oracle still has, newest first, for the download. */
export async function clipMonths(placeId: string): Promise<{ month: string; n: number }[]> {
  return prisma.$queryRaw<{ month: string; n: number }[]>`
    select to_char(c."ts", 'YYYY-MM') as month, count(*)::int as n from "Clip" c join "Device" d on d."id" = c."deviceId"
    where d."placeId" = ${placeId} and c."file" is not null group by 1 order by 1 desc`;
}

/** Letters and digits that cannot be read for one another (no 0/o, 1/l/i). */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newApPsk(): string {
  const s = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** The password of the node's own WiFi, drawn and stored the first time it is needed. */
export async function apPskFor(deviceId: string, have: string | null): Promise<string> {
  if (have) return have;
  const psk = newApPsk();
  const n = await prisma.device.updateMany({ where: { id: deviceId, visitApPsk: null }, data: { visitApPsk: psk } });
  if (n.count) return psk;
  return (await prisma.device.findUniqueOrThrow({ where: { id: deviceId }, select: { visitApPsk: true } })).visitApPsk ?? psk;
}

export type VisitOut = { rev: number; device: string; ssid: string; psk: string; apPsk: string };

type VisitRow = { visitSsid: string | null; visitPsk: string | null; visitApPsk: string | null; visitRev: number };

/** The visit settings for the heartbeat answer, only when the node reports a rev (it runs life-visit) other than the
 * current one. The device id rides along: the node needs it to sign a laptop's grant. */
export async function visitFor(deviceId: string, d: VisitRow, nodeRev: unknown): Promise<VisitOut | undefined> {
  if (typeof nodeRev !== "number" || nodeRev === d.visitRev) return undefined;
  return { rev: d.visitRev, device: deviceId, ssid: d.visitSsid ?? VISIT_DEFAULTS.ssid, psk: d.visitPsk ?? VISIT_DEFAULTS.psk, apPsk: await apPskFor(deviceId, d.visitApPsk) };
}

export type ClipsOnNode = { keep: boolean; waiting: number; mb: number; full: boolean; handed: number; collectedAt: string | null; sentAt: string | null } | null;

/** How the node's last visit went (its heartbeat's `visitLast`): online (it was on a cable or a WiFi), hotspot, wifi
 * (the node's own, for a laptop), hotspot+wifi, or none (nothing to take, or nobody came). */
export type LastVisit = { at: string; reason: string | null; how: string; sent: number; handed: number; minutes: number | null; laptop: boolean } | null;

function lastVisit(v: unknown): LastVisit {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const l = v as Record<string, unknown>;
  if (typeof l.at !== "string" || Number.isNaN(Date.parse(l.at))) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    at: l.at, reason: typeof l.reason === "string" ? l.reason : null, how: typeof l.how === "string" ? l.how : "none",
    sent: n(l.sent), handed: n(l.handed), minutes: typeof l.minutes === "number" ? l.minutes : null, laptop: l.laptop === true,
  };
}

/** What the owner sees and sets: the visit settings, whether the node has them yet, its clips and its last visit as its
 * last heartbeat said, and the alarm window. */
export async function visitState(deviceId: string) {
  const [d, hb] = await Promise.all([
    prisma.device.findUniqueOrThrow({ where: { id: deviceId }, select: { visitSsid: true, visitPsk: true, visitApPsk: true, visitRev: true, maintenanceFrom: true, maintenanceUntil: true } }),
    prisma.heartbeat.findFirst({ where: { deviceId }, orderBy: { ts: "desc" }, select: { ts: true, metrics: true } }),
  ]);
  const m = (hb?.metrics ?? {}) as Record<string, unknown>;
  const nodeRev = typeof m.visitRev === "number" ? m.visitRev : null;
  const handed = typeof m.clipsHanded === "string" ? m.clipsHanded.split(",").reduce((s, b) => s + (Number(b.split(":")[1]) || 0), 0) : 0;
  const clips: ClipsOnNode = typeof m.clipsWaiting === "number" ? {
    keep: m.clipsKeep === true, waiting: m.clipsWaiting, mb: typeof m.clipsMb === "number" ? m.clipsMb : 0, full: m.clipsFull === true, handed,
    collectedAt: typeof m.clipsCollectedAt === "string" ? m.clipsCollectedAt : null, sentAt: typeof m.clipsSentAt === "string" ? m.clipsSentAt : null,
  } : null;
  return {
    device: deviceId,
    ssid: d.visitSsid ?? VISIT_DEFAULTS.ssid, psk: d.visitPsk ?? VISIT_DEFAULTS.psk, apSsid: apSsid(deviceId), apPsk: await apPskFor(deviceId, d.visitApPsk),
    defaults: { ssid: d.visitSsid === null, psk: d.visitPsk === null },
    rev: d.visitRev, nodeRev, nodeHas: nodeRev === d.visitRev, heardAt: hb?.ts.toISOString() ?? null, clips, last: lastVisit(m.visitLast),
    maintenance: d.maintenanceUntil && d.maintenanceUntil > new Date() ? { from: d.maintenanceFrom?.toISOString() ?? null, until: d.maintenanceUntil.toISOString() } : null,
  };
}

export type VisitState = Awaited<ReturnType<typeof visitState>>;

/** A WiFi name is 1 to 32 bytes; a WPA2 password 8 to 63 printable ASCII characters. */
const Ssid = z.string().trim().min(1).refine((s) => Buffer.byteLength(s, "utf8") <= 32, "a WiFi name is at most 32 bytes").refine((s) => !/[\u0000-\u001f]/.test(s), "no control characters");
const Psk = z.string().regex(/^[\x20-\x7e]{8,63}$/, "8 to 63 letters, digits or signs, no accents");

/** PUT body of the owner's visit settings: a value sets it, null puts the default back. */
export const VisitBody = z.object({ ssid: Ssid.nullable().optional(), psk: Psk.nullable().optional(), apPsk: Psk.nullable().optional() });
