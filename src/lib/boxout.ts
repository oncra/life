import type { Box } from "@/generated/prisma/client";
import { boxDeviceNote } from "@/lib/boximage";
import { batteryOf } from "@/lib/battery";

const num = (v: unknown) => (typeof v === "number" ? v : null);

/** The box's own condition from its latest heartbeat, and the battery's lowest and highest over the past week. */
export function healthOf(ts: Date | null, m: Record<string, unknown> | null | undefined, week: { ts: Date; metrics: unknown }[]) {
  if (!ts || !m) return null;
  const batt = batteryOf(m);
  const series = week.map((h) => ({ ts: h.ts, b: batteryOf(h.metrics as Record<string, unknown> | null) })).filter((x) => x.b);
  const low = series.reduce<(typeof series)[number] | null>((a, x) => (!a || x.b!.v < a.b!.v ? x : a), null);
  const high = series.reduce<(typeof series)[number] | null>((a, x) => (!a || x.b!.v > a.b!.v ? x : a), null);
  return {
    ts, battV: batt?.v ?? null, battSrc: batt?.src ?? null,
    battA: num(m.battA), pvW: num(m.pvW), charge: typeof m.charge === "string" ? m.charge : null, mpptErr: num(m.mpptErr),
    yieldTodayWh: num(m.yieldTodayWh), yieldYdayWh: num(m.yieldYdayWh),
    piW: num(m.piW), boxTempC: num(m.boxTempC), cpuTempC: num(m.cpuTempC), diskFreeMb: num(m.diskFreeMb),
    throttled: typeof m.throttled === "string" && m.throttled !== "0x0" ? m.throttled : null, wake: typeof m.wake === "string" ? m.wake : null,
    week: low && high ? { low: { v: low.b!.v, ts: low.ts }, high: { v: high.b!.v, ts: high.ts }, n: series.length } : null,
  };
}

/** The boxes a person may see and manage: the ones they made, and every box on a place they own. Two people who both
 * own a place (granted via /api/v1/places/{id}/access) each sign in with their own address and see the same box. */
export function boxesOf(userId: string) {
  return { OR: [{ userId }, { place: { access: { some: { userId, role: "owner" } } } }] };
}

/** Everyone who manages a box, for the line "shared with" on the box page. */
export const boxOwnersInclude = { user: { select: { email: true } }, place: { select: { slug: true, name: true, access: { where: { role: "owner" }, select: { user: { select: { email: true } } } } } } } as const;
export function ownersOf(b: { user: { email: string }; place: { access: { user: { email: string } }[] } }): string[] {
  return [...new Set([b.user.email, ...b.place.access.map((a) => a.user.email)])];
}

/** What the box page shows about one box. The node password is for people who want to log in to the box itself. */
/** `golden` is the version of the golden image on the server now; a box image built on an older one is stale, because
 * its own first part no longer fits the shared rest that the download appends. */
export function boxOut(b: Box & { place: { slug: string; name?: string } }, golden?: string | null) {
  return {
    id: b.id, name: b.name, hostname: b.hostname, nodePassword: b.nodePassword, wifiSsid: b.wifiSsid,
    imageStatus: b.imageStatus, imageError: b.imageError, imageVersion: b.imageVersion, imageBytes: b.imageBytes ? Number(b.imageBytes) : null,
    stale: b.imageStatus === "READY" && !!golden && b.imageVersion !== golden,
    builtAt: b.builtAt, placedAt: b.placedAt, placeSlug: b.place.slug, placeName: b.ownPlace ? null : (b.place.name ?? null), createdAt: b.createdAt,
  };
}

/** What the box has sent so far: the builder's test lights. One query per kind, newest first. */
/** What the box's own devices last sent. `hostname` picks this box's devices on a place that carries more than one. */
export async function boxLive(placeId: string, hostname?: string) {
  const { prisma } = await import("./db");
  const devices = await prisma.device.findMany({ where: { placeId, ...(hostname ? { notes: boxDeviceNote(hostname) } : {}) }, select: { id: true, kind: true, depthCm: true, lastSeenAt: true, lastHeartbeatAt: true } });
  const ids = devices.map((d) => d.id);
  const sound = devices.find((d) => d.kind === "SOUND");
  const hb = await prisma.heartbeat.findFirst({ where: { deviceId: { in: ids } }, orderBy: { ts: "desc" }, select: { ts: true, cell: true, event: true, metrics: true } });
  // a week of battery, for the low point: the boot heartbeat after a night is the one that counts
  const week = await prisma.heartbeat.findMany({ where: { deviceId: { in: ids }, ts: { gte: new Date(Date.now() - 7 * 864e5) } }, select: { ts: true, metrics: true }, orderBy: { ts: "asc" } });
  const det = sound ? await prisma.soundDetection.findFirst({ where: { deviceId: sound.id }, orderBy: { ts: "desc" }, select: { ts: true, species: true, confidence: true } }) : null;
  const soil = await Promise.all(devices.filter((d) => d.kind === "SOIL").sort((a, b) => (a.depthCm ?? 0) - (b.depthCm ?? 0)).map(async (d) => {
    const r = await prisma.soilReading.findFirst({ where: { deviceId: d.id }, orderBy: { ts: "desc" }, select: { ts: true, vwc: true, tempC: true } });
    return { depthCm: d.depthCm, last: r };
  }));
  const cell = hb?.cell as { plmn?: string; cellId?: string | number } | null | undefined;
  return {
    heardAt: [hb?.ts, ...devices.map((d) => d.lastSeenAt)].filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null,
    heartbeatAt: hb?.ts ?? null,
    on4g: !!(cell && (cell.plmn || cell.cellId)),
    detection: det ? { ts: det.ts, species: det.species, confidence: det.confidence } : null,
    soil,
    health: healthOf(hb?.ts ?? null, hb?.metrics as Record<string, unknown> | null | undefined, week),
  };
}
