// The node dashboard (/places/{slug}/node): what a Life Node measured and how it was doing, over time. Everything here
// is read from the rows the node posted; nothing is modelled. The page is public for every place, so nothing in
// `NodeOut` says where the node stands: the map point comes from `signalPoint`, which blurs it for the public.
import type { Place } from "@/generated/prisma/client";
import { prisma } from "./db";
import { batteryOf } from "./battery";
import { DEFAULT_BLUR_M } from "./privacy";
import { DISPLAY_ZONE, dayLabel, dayStart, dayStarts } from "./clock";
import { nights } from "./sun";
import { POST_EVERY_H, type NodeSignal } from "./node-signal";
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

/** Longer than the posting rhythm (POST_EVERY_H) plus the margin a slow post needs: a silence. */
const MISSED_MS = (POST_EVERY_H + 0.75) * 3600e3;
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
  /** detections marked as test (made while the node was built): shown as proof the box worked, counted nowhere */
  tests: { n: number; first: number; last: number } | null;
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

  const [hbs, soil, species, chorus, todayCount, tests] = await Promise.all([
    // a day before the span too, so a silence that began before it still shows
    prisma.heartbeat.findMany({ where: { deviceId: { in: ids }, ts: { gte: new Date(from - 864e5), lte: new Date(to) } }, orderBy: { ts: "asc" }, select: { ts: true, event: true, cell: true, metrics: true } }),
    soilIds.length ? prisma.soilReading.findMany({ where: { deviceId: { in: soilIds }, ts: { gte: new Date(from), lte: new Date(to) } }, orderBy: { ts: "asc" }, select: { deviceId: true, ts: true, depthCm: true, vwc: true, tempC: true } }) : [],
    speciesTable(soundIds, zone, now),
    chorusGrid(soundIds, zone, now),
    soundIds.length ? prisma.soundDetection.count({ where: { deviceId: { in: soundIds }, test: false, ts: { gte: new Date(dayStart(now, zone)) } } }) : 0,
    soundIds.length ? prisma.soundDetection.aggregate({ where: { deviceId: { in: soundIds }, test: true }, _count: true, _min: { ts: true }, _max: { ts: true } }) : null,
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
    tests: tests && tests._count && tests._min.ts && tests._max.ts ? { n: tests._count, first: tests._min.ts.getTime(), last: tests._max.ts.getTime() } : null,
    chorus,
  };
}

/** The most recently heard species, newest first, each with its latest detection and its cut-out picture when the
 * worker has made one (src/lib/species-image.ts). One row per species, whatever name it came under: BirdNET-Go's own
 * database keeps only the scientific name, and clients/birdnet-pi-push.py falls back to it when BirdNET-Go has no
 * common name to hand, so the node may send "Corvus corone" an hour after "Carrion Crow". They are one bird. A species
 * is its scientific name; the row is named by a common name if any detection or picture of that species carries one. */
export type HeardRow = {
  /** the species as one thing: its scientific name, or the detector's name when it gave no scientific one */
  key: string;
  /** the common name (the detector's, else Wikidata's English one), else the scientific name */
  species: string; scientific: string | null;
  /** common names by language from Wikidata (en, nl, de, fr, es, zh), when the worker has looked them up */
  names: Record<string, string> | null;
  t: number; confidence: number; status: string | null; placeId: string;
  image: { id: string; width: number; height: number; author: string | null; license: string | null; licenseUrl: string | null; sourceUrl: string | null; title: string | null } | null;
};
export async function heard(opts: { placeId?: string; limit?: number; minConfidence?: number; withImage?: boolean } = {}): Promise<HeardRow[]> {
  const n = Math.max(1, Math.min(opts.limit ?? 5, 50));
  const placeId = opts.placeId ?? null;
  // with pictures only, read further down the list: a species heard for the first time waits up to an hour for its own
  const rows = await prisma.$queryRaw<{ key: string; species: string; scientific: string | null; ts: Date; confidence: number; placeId: string }[]>`
    select key, species, scientific, ts, confidence, "placeId" from (
      select distinct on (coalesce(d.scientific, d.species)) coalesce(d.scientific, d.species) as key,
        d.species, d.scientific, d.ts, d.confidence, v."placeId"
      from "SoundDetection" d join "Device" v on v.id = d."deviceId"
      where not d.test and (${placeId}::text is null or v."placeId" = ${placeId}::text) and d.confidence >= ${opts.minConfidence ?? 0}
      order by coalesce(d.scientific, d.species), d.ts desc) x
    order by ts desc limit ${opts.withImage ? 200 : n}`;
  if (rows.length === 0) return [];
  const keys = rows.map((r) => r.key);
  const imgs = await prisma.speciesImage.findMany({
    where: { OR: [{ species: { in: [...new Set([...keys, ...rows.map((r) => r.species)])] } }, { scientific: { in: keys } }] },
    select: { id: true, species: true, scientific: true, status: true, width: true, height: true, author: true, license: true, licenseUrl: true, sourceUrl: true, title: true, names: true },
  });
  const out: HeardRow[] = [];
  for (const r of rows) {
    const mine = imgs.filter((i) => i.species === r.species || i.species === r.key || i.scientific === r.key);
    const common = r.species !== r.key ? r.species : (mine.find((i) => i.species !== r.key)?.species ?? null);
    const ready = mine.filter((i) => i.status === "ready");
    const img = ready.find((i) => i.species === common) ?? ready.find((i) => i.species === r.species) ?? ready[0] ?? null;
    if (opts.withImage && !img) continue;
    const named = [img, ...mine].find((i) => i?.names && typeof i.names === "object" && Object.keys(i.names).length)?.names as Record<string, string> | undefined;
    out.push({
      key: r.key, species: common ?? named?.en ?? r.species, scientific: r.scientific ?? img?.scientific ?? null, names: named ?? null,
      t: r.ts.getTime(), confidence: r.confidence, status: img?.status ?? mine[0]?.status ?? null, placeId: r.placeId,
      image: img ? { id: img.id, width: img.width ?? 0, height: img.height ?? 0, author: img.author, license: img.license, licenseUrl: img.licenseUrl, sourceUrl: img.sourceUrl, title: img.title } : null,
    });
    if (out.length >= n) break;
  }
  return out;
}
/** The node dashboard's row: the last species heard on one place, every confidence. */
export function lastHeard(placeId: string, n = 5): Promise<HeardRow[]> {
  return heard({ placeId, limit: n });
}

/** Whether a node is listening, for a page that shows what it hears: `asleep` after a planned shutdown (the field
 * schedule switches it off part of the day to spare the battery), `listening` while it posts in its rhythm, `quiet`
 * when a post is late, `silent` when the SILENT alert would be open. */
export type NodeState = { placeId: string; slug: string; status: "listening" | "asleep" | "quiet" | "silent"; heardAt: number | null; lastEvent: string | null };
export async function nodeStates(now = Date.now(), placeId?: string): Promise<NodeState[]> {
  const places = await prisma.place.findMany({
    where: { ...(placeId ? { id: placeId } : {}), devices: { some: { OR: [{ lastHeartbeatAt: { not: null } }, { lastSeenAt: { not: null } }] } } },
    select: { id: true, slug: true, devices: { select: { id: true, lastHeartbeatAt: true, lastSeenAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(places.map(async (p) => {
    const seen = Math.max(0, ...p.devices.map((d) => ms(d.lastSeenAt) ?? 0), ...p.devices.map((d) => ms(d.lastHeartbeatAt) ?? 0)) || null;
    const beat = await prisma.heartbeat.findFirst({ where: { deviceId: { in: p.devices.map((d) => d.id) } }, orderBy: { ts: "desc" }, select: { ts: true, event: true } });
    const age = seen ? now - seen : Infinity;
    const status: NodeState["status"] = beat?.event === "shutdown" && age < 36 * 3600e3 ? "asleep"
      : age < (POST_EVERY_H + 1) * 3600e3 ? "listening" : age < 36 * 3600e3 ? "quiet" : "silent";
    return { placeId: p.id, slug: p.slug, status, heardAt: seen, lastEvent: beat?.event ?? null };
  }));
}

/** Species heard, with counts for today (local), the past seven days and all time: one row per species, named by its
 * common name when any detection carries one (see `HeardRow`). */
async function speciesTable(ids: string[], zone: string, now: number): Promise<SpeciesRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<{ species: string; scientific: string | null; today: number; week: number; total: number; conf: number; last: Date }[]>`
    select coalesce(max(species) filter (where scientific is null or species <> scientific), max(species)) as species, max(scientific) as scientific,
      (count(*) filter (where ts >= ${iso(dayStart(now, zone))}::timestamptz at time zone 'UTC'))::int as today,
      (count(*) filter (where ts >= ${iso(now - 7 * 864e5)}::timestamptz at time zone 'UTC'))::int as week,
      count(*)::int as total, max(confidence)::float as conf, max(ts) as last
    from "SoundDetection" where "deviceId" = any(${ids}::text[]) and not test
    group by coalesce(scientific, species) order by week desc, total desc, last desc limit 80`;
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
      from (select (ts at time zone 'UTC') at time zone ${zone} as l from "SoundDetection" where "deviceId" = any(${ids}::text[]) and not test and ts >= ${iso(starts[0])}::timestamptz at time zone 'UTC') x
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
      sound.length ? prisma.soundDetection.findFirst({ where: { deviceId: { in: sound }, test: false }, orderBy: { ts: "desc" }, select: { ts: true, species: true } }) : null,
      sound.length ? prisma.soundDetection.groupBy({ by: ["species", "scientific"], where: { deviceId: { in: sound }, test: false, ts: { gte: new Date(now - 7 * 864e5) } } }) : [],
    ]);
    const pt = signalPoint(p, false);
    const hb = Math.max(0, ...p.devices.map((d) => ms(d.lastHeartbeatAt) ?? 0));
    const seen = Math.max(hb, ...p.devices.map((d) => ms(d.lastSeenAt) ?? 0));
    out.push({
      slug: p.slug, name: p.name, lat: pt.lat, lon: pt.lon, radiusM: pt.radiusM,
      heardAt: seen ? new Date(seen).toISOString() : null, heartbeatAt: hb ? new Date(hb).toISOString() : null,
      lastSpecies: det?.species ?? null, lastSpeciesAt: det?.ts.toISOString() ?? null, speciesWeek: new Set(week.map((w) => w.scientific ?? w.species)).size, href: `/places/${p.slug}/node`,
    });
  }
  return out;
}
