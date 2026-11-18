import type { Place } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DISPLAY_ZONE } from "@/lib/clock";
import { heard, nodeStatus, signalPoint, sunPlace, type HeardRow } from "@/lib/node";
import type { NodeStatusOut } from "@/lib/node-status";
import { locateCell, type CellPos } from "@/lib/cell-locate";

/** A node's demo page (/places/{slug}/demo): the birds as they come in, how the node is doing, and while the place's
 * demo is on (Place.demoUntil) where it is now, from the 4G mast it hears. Polled every few seconds by the page. Public
 * like the dashboard; the position only exists during a demo a manager started, and goes when it ends. */

export const DEMO_MAX_H = 6;
/** a live post's position counts this long: the node posts every twenty seconds while live */
const POS_FRESH_MS = 10 * 60e3;
/** on 4G a heartbeat comes with the sound post, three minutes after boot and then every three hours (life-sound.timer) */
const CELL_FRESH_MS = 190 * 60e3;

export type DemoBird = Pick<HeardRow, "key" | "species" | "scientific" | "names" | "image">;
export type DemoOut = {
  now: number;
  zone: string;
  place: { slug: string; name: string };
  demo: { on: boolean; until: number | null };
  status: NodeStatusOut | null;
  /** the last species heard, newest first, one tile each */
  heard: (DemoBird & { t: number; confidence: number })[];
  /** the last detections one by one, newest first; test ones too (a phone played to the mic), marked */
  feed: { id: string; key: string; t: number; confidence: number; test: boolean }[];
  /** what the feed's species are called and look like */
  birds: Record<string, DemoBird>;
  /** where the node is now (during a demo only) and the place as the public sees it */
  pos: (CellPos & { operator: string | null }) | null;
  home: { lat: number; lon: number; radiusM: number | null };
};

export function demoOn(p: Pick<Place, "demoUntil">, now = Date.now()): boolean {
  return (p.demoUntil?.getTime() ?? 0) > now;
}

export async function demoData(place: Place, exact: boolean, now = Date.now()): Promise<DemoOut> {
  const on = demoOn(place, now);
  const [status, species, dets, devices] = await Promise.all([
    nodeStatus(sunPlace(place, exact), now),
    heard({ placeId: place.id, limit: 40 }),
    prisma.soundDetection.findMany({
      where: { device: { placeId: place.id } }, orderBy: { ts: "desc" }, take: 30,
      select: { id: true, ts: true, species: true, scientific: true, confidence: true, test: true },
    }),
    on ? prisma.device.findMany({ where: { placeId: place.id, kind: "SOUND" }, select: { live: true, cell: true } }) : [],
  ]);
  // what BirdNET also names that is not a species (Engine, Siren, Dog, Human vocal...) has no binomial: not on the board
  const living = (key: string) => /\s/.test(key.trim());
  const birds: Record<string, DemoBird> = {};
  for (const h of species) birds[h.key] = { key: h.key, species: h.species, scientific: h.scientific, names: h.names, image: h.image };
  const feed = dets.filter((d) => living(d.scientific ?? d.species)).map((d) => {
    const key = d.scientific ?? d.species;
    // a species heard only in tests is not in `heard()`: its own row names it
    if (!birds[key]) birds[key] = { key, species: d.species, scientific: d.scientific, names: null, image: null };
    return { id: String(d.id), key, t: d.ts.getTime(), confidence: d.confidence, test: d.test };
  });
  let pos: DemoOut["pos"] = null;
  for (const d of devices) {
    const live = d.live as { pos?: CellPos; cell?: { plmn?: string } | null; metrics?: Record<string, unknown> } | null;
    const p = live?.pos;
    if (p && typeof p.lat === "number" && now - p.at <= POS_FRESH_MS && (!pos || p.at > pos.at)) pos = { ...p, operator: status?.link.operator ?? null };
  }
  // on 4G the node sends no live posts, but each heartbeat carries the cell it is on (Device.cell): place that one
  if (!pos) {
    for (const d of devices) {
      const c = d.cell as (Parameters<typeof locateCell>[0] & { seenAt?: string }) | null;
      const seen = c?.seenAt ? Date.parse(c.seenAt) : 0;
      if (!c || !(now - seen <= CELL_FRESH_MS)) continue;
      const p = await locateCell(c, now);
      if (p && (!pos || seen > pos.at)) pos = { ...p, at: seen, operator: status?.link.operator ?? null };
    }
  }
  return {
    now, zone: DISPLAY_ZONE,
    place: { slug: place.slug, name: place.name },
    demo: { on, until: on ? place.demoUntil!.getTime() : null },
    status,
    heard: species.filter((h) => living(h.key)).slice(0, 6).map((h) => ({ key: h.key, species: h.species, scientific: h.scientific, names: h.names, image: h.image, t: h.t, confidence: h.confidence })),
    feed: feed.slice(0, 14), birds, pos,
    home: signalPoint(place, exact),
  };
}

/** Start a demo for `hours` (the node also stays on that long: a maintenance window on its Life Node devices), or end it. */
export async function setDemo(place: Pick<Place, "id" | "demoUntil">, hours: number | null): Promise<number | null> {
  const now = new Date();
  const devices = await prisma.device.findMany({ where: { placeId: place.id, kind: "SOUND" }, select: { id: true, maintenanceUntil: true } });
  if (hours === null) {
    const until = place.demoUntil;
    await prisma.place.update({ where: { id: place.id }, data: { demoUntil: null } });
    // close the window the demo opened, not one the owner set for longer
    for (const d of devices) {
      if (until && d.maintenanceUntil && d.maintenanceUntil.getTime() === until.getTime() && until > now) {
        await prisma.device.update({ where: { id: d.id }, data: { maintenanceUntil: now } });
      }
    }
    return null;
  }
  const until = new Date(now.getTime() + Math.min(Math.max(hours, 0.25), DEMO_MAX_H) * 3600e3);
  await prisma.place.update({ where: { id: place.id }, data: { demoUntil: until } });
  for (const d of devices) {
    if (!d.maintenanceUntil || d.maintenanceUntil < until) {
      await prisma.device.update({ where: { id: d.id }, data: { maintenanceFrom: now, maintenanceUntil: until } });
    }
  }
  return until.getTime();
}
