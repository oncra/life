// The node dashboard (/places/{slug}/node): what a Life Node measured and how it was doing, over time. Everything here
// is read from the rows the node posted; nothing is modelled. The page is public for every place, so nothing in
// `NodeOut` says where the node stands: the map point comes from `signalPoint`, which blurs it for the public.
import type { Place } from "@/generated/prisma/client";
import { prisma } from "./db";
import { batteryOf } from "./battery";
import { DEFAULT_BLUR_M } from "./privacy";
import { DISPLAY_ZONE, dayLabel, dayStart, dayStarts } from "./clock";
import { nights } from "./sun";
import { type NodeSignal } from "./node-signal";
export { POST_EVERY_H, signalStatus, type NodeSignal } from "./node-signal";

export type Range = "24h" | "7d" | "30d" | "all";
export const RANGES: { key: Range; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "everything" },
];
export function asRange(s: string | string[] | undefined): Range {
  const k = Array.isArray(s) ? s[0] : s;
  return RANGES.some((r) => r.key === k) ? (k as Range) : "7d";
}

/** Longer than the two-hour posting rhythm (POST_EVERY_H) plus the margin a slow post needs: a silence. */
const MISSED_MS = 2.75 * 3600e3;
/** A heartbeat this soon after the box came up is its first after a start. */
const STARTED_S = 900;

/** [epoch ms, value] */
export type Pt = [number, number];
export type Beat = { t: number; event: string | null; start: boolean; wake: string | null; unsent: number | null; battV: number | null };
/** A silence longer than the posting rhythm: after a shutdown the box is asleep as planned; otherwise a post is missing. */
export type Gap = { from: number; to: number; kind: "asleep" | "missed"; open: boolean };
export type SpeciesRow = { species: string; scientific: string | null; today: number; week: number; total: number; conf: number; last: number };

export type NodeOut = {
  zone: string;
  now: number;
  from: number;
  to: number;
  range: Range;
  /** [sunset, sunrise] pairs inside the span, for the night bands */
  night: [number, number][];
  devices: { id: string; kind: string; model: string; depthCm: number | null; lastSeenAt: number | null; lastHeartbeatAt: number | null }[];
  last: {
    heardAt: number | null;
    heartbeatAt: number | null;
    battV: number | null;
    battSrc: "mppt" | "wittypi" | null;
    boxTempC: number | null;
    cpuTempC: number | null;
    piW: number | null;
    pvW: number | null;
    diskFreeMb: number | null;
    unsent: number | null;
    /** the mobile network the node was on; never the cell id, which is where it stands */
    network: { plmn: string; name: string; rssi: number | null; rsrp: number | null } | null;
  };
  beats: Beat[];
  gaps: Gap[];
  soil: { depthCm: number | null; vwc: Pt[]; tempC: Pt[]; last: { t: number; vwc: number | null; tempC: number | null } | null }[];
  box: { battV: Pt[]; boxTempC: Pt[]; cpuTempC: Pt[]; piW: Pt[]; pvW: Pt[] };
  species: SpeciesRow[];
  heardToday: number;
  heardWeek: number;
  detectionsToday: number;
  /** detections per local hour over the last fortnight: days newest last, cells keyed `${dayIndex}:${hour}` */
  chorus: { days: { t: number; label: string }[]; cells: Record<string, number>; max: number };
};

const OPERATORS: Record<string, string> = { "20404": "Vodafone NL", "20408": "KPN", "20416": "Odido (T-Mobile NL)" };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);
// The raw queries below take plain parameters only: a UTC instant as an ISO string cast with `::timestamptz at time
// zone 'UTC'` against the `timestamp` columns (which store UTC wall time), and the device ids as a text array. Not
// `Prisma.sql` or `Prisma.join`: in `next dev` a route handler can get a Prisma client that another bundle created,
// whose `instanceof` check then fails, and the fragment goes to Postgres as one JSON-stringified parameter.
const iso = (t: number) => new Date(t).toISOString();

/** The whole dashboard for one place, or null when it has no devices. */
export async function nodeData(place: Pick<Place, "id" | "centroidLat" | "centroidLon">, range: Range, now = Date.now()): Promise<NodeOut | null> {
  const zone = DISPLAY_ZONE;
  const devices = await prisma.device.findMany({ where: { placeId: place.id }, select: { id: true, kind: true, model: true, depthCm: true, lastSeenAt: true, lastHeartbeatAt: true } });
  if (devices.length === 0) return null;
  const ids = devices.map((d) => d.id);
  const soilIds = devices.filter((d) => d.kind === "SOIL").map((d) => d.id);
  const soundIds = devices.filter((d) => d.kind === "SOUND").map((d) => d.id);

  let from: number;
  if (range === "all") {
    const firsts = await Promise.all([
      prisma.heartbeat.findFirst({ where: { deviceId: { in: ids } }, orderBy: { ts: "asc" }, select: { ts: true } }),
      prisma.soilReading.findFirst({ where: { deviceId: { in: ids } }, orderBy: { ts: "asc" }, select: { ts: true } }),
      prisma.soundDetection.findFirst({ where: { deviceId: { in: ids } }, orderBy: { ts: "asc" }, select: { ts: true } }),
    ]);
    const t0 = Math.min(...firsts.map((f) => f?.ts.getTime() ?? Infinity));
    from = Number.isFinite(t0) ? t0 - 3600e3 : now - 7 * 864e5;
  } else {
    from = now - (range === "24h" ? 864e5 : range === "7d" ? 7 * 864e5 : 30 * 864e5);
  }
  const to = now;

  const [hbs, soil, species, chorus, todayCount] = await Promise.all([
    // a day before the span too, so a silence that began before it still shows
    prisma.heartbeat.findMany({ where: { deviceId: { in: ids }, ts: { gte: new Date(from - 864e5), lte: new Date(to) } }, orderBy: { ts: "asc" }, select: { ts: true, event: true, cell: true, metrics: true } }),
    soilIds.length ? prisma.soilReading.findMany({ where: { deviceId: { in: soilIds }, ts: { gte: new Date(from), lte: new Date(to) } }, orderBy: { ts: "asc" }, select: { deviceId: true, ts: true, depthCm: true, vwc: true, tempC: true } }) : [],
    speciesTable(soundIds, zone, now),
    chorusGrid(soundIds, zone, now),
    soundIds.length ? prisma.soundDetection.count({ where: { deviceId: { in: soundIds }, ts: { gte: new Date(dayStart(now, zone)) } } }) : 0,
  ]);

  // heartbeats: the strip, the silences, and the box's own series
  const beats: Beat[] = [];
  const box: NodeOut["box"] = { battV: [], boxTempC: [], cpuTempC: [], piW: [], pvW: [] };
  const gaps: Gap[] = [];
  let prev: { t: number; event: string | null } | null = null;
  for (const h of hbs) {
    const t = h.ts.getTime();
    const m = (h.metrics ?? null) as Record<string, unknown> | null;
    const batt = batteryOf(m);
    if (prev && t - prev.t > MISSED_MS) gaps.push({ from: prev.t, to: t, kind: prev.event === "shutdown" ? "asleep" : "missed", open: false });
    prev = { t, event: h.event };
    if (t < from) continue;
    beats.push({ t, event: h.event, start: (num(m?.uptimeS) ?? Infinity) < STARTED_S, wake: typeof m?.wake === "string" ? m.wake : null, unsent: num(m?.unsent), battV: batt?.v ?? null });
    if (batt) box.battV.push([t, batt.v]);
    for (const k of ["boxTempC", "cpuTempC", "piW", "pvW"] as const) {
      const v = num(m?.[k]);
      if (v !== null) box[k].push([t, v]);
    }
  }
  if (prev && to - prev.t > MISSED_MS) gaps.push({ from: prev.t, to, kind: prev.event === "shutdown" ? "asleep" : "missed", open: true });
  const gapsIn = gaps.filter((g) => g.to > from).map((g) => ({ ...g, from: Math.max(g.from, from) }));

  const lastHb = hbs.length ? hbs[hbs.length - 1] : null;
  const lm = (lastHb?.metrics ?? null) as Record<string, unknown> | null;
  const cell = (lastHb?.cell ?? null) as { plmn?: string | number; rssi?: number; rsrp?: number } | null;
  const plmn = cell?.plmn != null ? String(cell.plmn) : null;
  const lastBatt = batteryOf(lm);
  const heardAt = Math.max(0, ...devices.map((d) => ms(d.lastSeenAt) ?? 0), ...devices.map((d) => ms(d.lastHeartbeatAt) ?? 0)) || null;

  // soil: one series pair per probe, shallow first
  const soilDevices = devices.filter((d) => d.kind === "SOIL").sort((a, b) => (a.depthCm ?? 0) - (b.depthCm ?? 0));
  const soilOut = soilDevices.map((d) => {
    const rows = soil.filter((r) => r.deviceId === d.id);
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    return {
      depthCm: d.depthCm,
      vwc: rows.filter((r) => r.vwc !== null).map((r) => [r.ts.getTime(), r.vwc as number] as Pt),
      tempC: rows.filter((r) => r.tempC !== null).map((r) => [r.ts.getTime(), r.tempC as number] as Pt),
      last: lastRow ? { t: lastRow.ts.getTime(), vwc: lastRow.vwc, tempC: lastRow.tempC } : null,
    };
  });

  return {
    zone, now, from, to, range,
    night: nights(from, to, place.centroidLat, place.centroidLon),
    devices: devices.map((d) => ({ id: d.id, kind: d.kind, model: d.model, depthCm: d.depthCm, lastSeenAt: ms(d.lastSeenAt), lastHeartbeatAt: ms(d.lastHeartbeatAt) })),
    last: {
      heardAt,
      heartbeatAt: lastHb ? lastHb.ts.getTime() : null,
      battV: lastBatt?.v ?? null, battSrc: lastBatt?.src ?? null,
      boxTempC: num(lm?.boxTempC), cpuTempC: num(lm?.cpuTempC), piW: num(lm?.piW), pvW: num(lm?.pvW), diskFreeMb: num(lm?.diskFreeMb), unsent: num(lm?.unsent),
      network: plmn ? { plmn, name: OPERATORS[plmn] ?? `network ${plmn}`, rssi: num(cell?.rssi), rsrp: num(cell?.rsrp) } : null,
    },
    beats, gaps: gapsIn, soil: soilOut, box, species,
    heardToday: species.filter((s) => s.today > 0).length,
    heardWeek: species.filter((s) => s.week > 0).length,
    detectionsToday: todayCount,
    chorus,
  };
}

/** The most recently heard species on a place, each with its latest detection and its cut-out picture when the
 * worker has made one (src/lib/species-image.ts). */
export type HeardRow = {
  species: string; scientific: string | null; t: number; confidence: number; status: string | null;
  image: { id: string; width: number; height: number; author: string | null; license: string | null; licenseUrl: string | null; sourceUrl: string | null; title: string | null } | null;
};
export async function lastHeard(placeId: string, n = 5): Promise<HeardRow[]> {
  const rows = await prisma.$queryRaw<{ species: string; scientific: string | null; ts: Date; confidence: number }[]>`
    select species, scientific, ts, confidence from (
      select distinct on (species) species, scientific, ts, confidence from "SoundDetection"
      where "deviceId" in (select id from "Device" where "placeId" = ${placeId}) order by species, ts desc) x
    order by ts desc limit ${n}`;
  if (rows.length === 0) return [];
  const imgs = await prisma.speciesImage.findMany({ where: { species: { in: rows.map((r) => r.species) } }, select: { id: true, species: true, status: true, width: true, height: true, author: true, license: true, licenseUrl: true, sourceUrl: true, title: true } });
  return rows.map((r) => {
    const i = imgs.find((x) => x.species === r.species);
    return {
      species: r.species, scientific: r.scientific, t: r.ts.getTime(), confidence: r.confidence, status: i?.status ?? null,
      image: i && i.status === "ready" ? { id: i.id, width: i.width ?? 0, height: i.height ?? 0, author: i.author, license: i.license, licenseUrl: i.licenseUrl, sourceUrl: i.sourceUrl, title: i.title } : null,
    };
  });
}

/** Species heard, with counts for today (local), the past seven days and all time. */
async function speciesTable(ids: string[], zone: string, now: number): Promise<SpeciesRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<{ species: string; scientific: string | null; today: number; week: number; total: number; conf: number; last: Date }[]>`
    select species, max(scientific) as scientific,
      (count(*) filter (where ts >= ${iso(dayStart(now, zone))}::timestamptz at time zone 'UTC'))::int as today,
      (count(*) filter (where ts >= ${iso(now - 7 * 864e5)}::timestamptz at time zone 'UTC'))::int as week,
      count(*)::int as total, max(confidence)::float as conf, max(ts) as last
    from "SoundDetection" where "deviceId" = any(${ids}::text[])
    group by species order by week desc, total desc, last desc limit 80`;
  return rows.map((r) => ({ ...r, last: r.last.getTime() }));
}

/** Detections per local hour of the day over the last fourteen days: the dawn chorus as a grid. */
async function chorusGrid(ids: string[], zone: string, now: number): Promise<NodeOut["chorus"]> {
  const starts = dayStarts(now - 13 * 864e5, now, zone);
  const days = starts.map((t) => ({ t, label: dayLabel(t, zone) }));
  const cells: Record<string, number> = {};
  let max = 0;
  if (ids.length && starts.length) {
    const rows = await prisma.$queryRaw<{ day: string; hour: number; n: number }[]>`
      select to_char(l, 'YYYY-MM-DD') as day, extract(hour from l)::int as hour, count(*)::int as n
      from (select (ts at time zone 'UTC') at time zone ${zone} as l from "SoundDetection" where "deviceId" = any(${ids}::text[]) and ts >= ${iso(starts[0])}::timestamptz at time zone 'UTC') x
      group by 1, 2`;
    const index = new Map(starts.map((t, i) => [isoDay(t, zone), i]));
    for (const r of rows) {
      const i = index.get(r.day);
      if (i === undefined) continue;
      cells[`${i}:${r.hour}`] = r.n;
      if (r.n > max) max = r.n;
    }
  }
  return { days, cells, max };
}

function isoDay(t: number, zone: string): string {
  const d = new Date(t + 12 * 3600e3); // noon of that local day, safely inside it in any zone
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p; // en-CA gives YYYY-MM-DD
}

/** Where a node's signal is drawn on a map. Exact for viewers who may see the place exactly; the stored blurred centre
 * for a place that hides its location; and for a private place without one, the centroid snapped to a 0.1 degree grid
 * (about 7 km), which is the same answer every time, so nobody can average it back. */
export function signalPoint(p: Pick<Place, "public" | "locationHidden" | "blurLat" | "blurLon" | "blurRadiusM" | "centroidLat" | "centroidLon">, exact: boolean): { lat: number; lon: number; radiusM: number | null } {
  if (exact) return { lat: p.centroidLat, lon: p.centroidLon, radiusM: null };
  if (p.locationHidden && p.blurLat != null && p.blurLon != null) return { lat: p.blurLat, lon: p.blurLon, radiusM: p.blurRadiusM ?? DEFAULT_BLUR_M };
  if (!p.public) return { lat: +(Math.round(p.centroidLat * 10) / 10).toFixed(4), lon: +(Math.round(p.centroidLon * 10) / 10).toFixed(4), radiusM: 7000 };
  return { lat: p.centroidLat, lon: p.centroidLon, radiusM: null };
}

/** One signal per place that has a device which has reported: the pulsing dots on the map. Public: blurred points. */
export async function nodeSignals(now = Date.now()): Promise<NodeSignal[]> {
  const places = await prisma.place.findMany({
    where: { devices: { some: { OR: [{ lastHeartbeatAt: { not: null } }, { lastSeenAt: { not: null } }] } } },
    include: { devices: { select: { id: true, kind: true, lastHeartbeatAt: true, lastSeenAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  const out: NodeSignal[] = [];
  for (const p of places) {
    const sound = p.devices.filter((d) => d.kind === "SOUND").map((d) => d.id);
    const [det, week] = await Promise.all([
      sound.length ? prisma.soundDetection.findFirst({ where: { deviceId: { in: sound } }, orderBy: { ts: "desc" }, select: { ts: true, species: true } }) : null,
      sound.length ? prisma.soundDetection.groupBy({ by: ["species"], where: { deviceId: { in: sound }, ts: { gte: new Date(now - 7 * 864e5) } } }) : [],
    ]);
    const pt = signalPoint(p, false);
    const hb = Math.max(0, ...p.devices.map((d) => ms(d.lastHeartbeatAt) ?? 0));
    const seen = Math.max(hb, ...p.devices.map((d) => ms(d.lastSeenAt) ?? 0));
    out.push({
      slug: p.slug, name: p.name, lat: pt.lat, lon: pt.lon, radiusM: pt.radiusM,
      heardAt: seen ? new Date(seen).toISOString() : null, heartbeatAt: hb ? new Date(hb).toISOString() : null,
      lastSpecies: det?.species ?? null, lastSpeciesAt: det?.ts.toISOString() ?? null, speciesWeek: week.length, href: `/places/${p.slug}/node`,
    });
  }
  return out;
}
