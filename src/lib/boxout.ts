import type { Box } from "@/generated/prisma/client";

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
  const devices = await prisma.device.findMany({ where: { placeId, ...(hostname ? { notes: `Life Box ${hostname}` } : {}) }, select: { id: true, kind: true, depthCm: true, lastSeenAt: true, lastHeartbeatAt: true } });
  const ids = devices.map((d) => d.id);
  const sound = devices.find((d) => d.kind === "SOUND");
  const hb = await prisma.heartbeat.findFirst({ where: { deviceId: { in: ids } }, orderBy: { ts: "desc" }, select: { ts: true, cell: true, event: true } });
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
  };
}
