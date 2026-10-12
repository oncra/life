// The life index on the node dashboard: the verdict over time, and the three streams it is read from, on one
// timeline. Nothing here is a new method: the verdict per period is the stored readings put through `verdict()`
// (the weakest reading decides, nothing is summed), the satellite lane is the stored observations, and the sound
// and soil lanes are daily counts and means of the rows the node posted.
import type { Place } from "@/generated/prisma/client";
import { prisma } from "./db";
import { soilActivity, verdict, type Verdict } from "./readings";
import { moistureOptimum } from "./context";
import { DISPLAY_ZONE, dayStart } from "./clock";
import { coreWindowArrays } from "./listening";

export type IndexRange = "30d" | "1y" | "archive";
export const INDEX_RANGES: { key: IndexRange; label: string }[] = [
  { key: "30d", label: "30 days" },
  { key: "1y", label: "a year" },
  { key: "archive", label: "the whole archive" },
];
export function asIndexRange(s: string | string[] | undefined): IndexRange {
  const k = Array.isArray(s) ? s[0] : s;
  return INDEX_RANGES.some((r) => r.key === k) ? (k as IndexRange) : "1y";
}

export type ReadingChip = { dimension: string; direction: string; confidence: number; maturity: number; note: string | null };
export type Period = { period: string; from: number; to: number; verdict: Verdict; reason: string; readings: ReadingChip[] };

export type LifeIndexOut = {
  zone: string;
  now: number;
  from: number;
  to: number;
  range: IndexRange;
  /** the verdict per quarter, oldest first, only the quarters that have readings */
  periods: Period[];
  latest: Period | null;
  /** [t, ndvi] per clear scene inside the span */
  sat: [number, number][];
  satTotal: number;
  satSince: number | null;
  /** growing seasons inside the span, [from, to] */
  seasons: [number, number][];
  /** per local day: species heard (confidence 70% or more, in the core listening hours, as the diversity reading counts them) and all detections */
  sound: { t: number; species: number; detections: number }[];
  /** per local day, the shallowest probe: mean moisture, mean temperature, and the weather-expected soil activity (`soilActivity` in readings.ts) */
  soil: { t: number; vwc: number | null; tempC: number | null; activity: number | null }[];
  soilDepthCm: number | null;
  optimumVwc: number;
  /** when the node's first soil reading or detection arrived */
  nodeSince: number | null;
};

const iso = (t: number) => new Date(t).toISOString();

function periodBounds(period: string): [number, number] | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!m) return null;
  const y = Number(m[1]), q = Number(m[2]);
  return [Date.UTC(y, (q - 1) * 3, 1), Date.UTC(y, q * 3, 1)];
}

export async function lifeIndexData(place: Pick<Place, "id" | "centroidLat" | "centroidLon" | "context">, range: IndexRange, now = Date.now()): Promise<LifeIndexOut> {
  const zone = DISPLAY_ZONE;
  const to = now;
  const [firstSat, satTotal, devices] = await Promise.all([
    prisma.satelliteObs.findFirst({ where: { placeId: place.id }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.satelliteObs.count({ where: { placeId: place.id } }),
    prisma.device.findMany({ where: { placeId: place.id }, select: { id: true, kind: true, depthCm: true } }),
  ]);
  const from = range === "30d" ? now - 30 * 864e5 : range === "1y" ? now - 365 * 864e5 : Math.min(now - 365 * 864e5, (firstSat?.date.getTime() ?? now) - 15 * 864e5);
  const soundIds = devices.filter((d) => d.kind === "SOUND").map((d) => d.id);
  const soilDevices = devices.filter((d) => d.kind === "SOIL").sort((a, b) => (a.depthCm ?? 0) - (b.depthCm ?? 0));
  const shallow = soilDevices[0] ?? null;
  const clay = (place.context as { soil?: { clayPct?: number } } | null)?.soil?.clayPct;
  const optimumVwc = moistureOptimum(clay);
  const frame = { bulkDensity: (place.context as { soil?: { bulkDensity?: number } } | null)?.soil?.bulkDensity ?? null, optimumVwc };
  // species per day as the diversity reading counts them: confidence 0.7 or more, inside the core listening windows
  // (content/spec.md 2.2); the detections count beside it is everything the node heard
  const cw = coreWindowArrays(from, to, place.centroidLat, place.centroidLon);

  const [sat, readings, soundRows, soilRows, firstSound, firstSoil] = await Promise.all([
    prisma.satelliteObs.findMany({ where: { placeId: place.id, date: { gte: new Date(from), lte: new Date(to) } }, orderBy: { date: "asc" }, select: { date: true, ndviMean: true } }),
    prisma.reading.findMany({ where: { placeId: place.id }, orderBy: { computedAt: "desc" } }),
    soundIds.length
      ? prisma.$queryRaw<{ day: string; detections: number; species: number }[]>`
        select to_char((ts at time zone 'UTC') at time zone ${zone}, 'YYYY-MM-DD') as day, count(*)::int as detections,
          (count(distinct coalesce(scientific, species)) filter (where confidence >= 0.7 and (
            (ts >= (w.s1[k.i] at time zone 'UTC') and ts < (w.e1[k.i] at time zone 'UTC')) or
            (ts >= (w.s2[k.i] at time zone 'UTC') and ts < (w.e2[k.i] at time zone 'UTC')) or
            (ts >= (w.s2[k.i - 1] at time zone 'UTC') and ts < (w.e2[k.i - 1] at time zone 'UTC')))))::int as species
        from "SoundDetection"
          cross join (select ${cw.s1}::timestamptz[] as s1, ${cw.e1}::timestamptz[] as e1, ${cw.s2}::timestamptz[] as s2, ${cw.e2}::timestamptz[] as e2) as w
          cross join lateral (select (floor(extract(epoch from ts) / 86400) - ${cw.day0})::int + 1 as i) as k
        where "deviceId" = any(${soundIds}::text[]) and not test and ts >= ${iso(from)}::timestamptz at time zone 'UTC' and ts <= ${iso(to)}::timestamptz at time zone 'UTC'
        group by 1 order by 1`
      : [],
    shallow
      ? prisma.$queryRaw<{ day: string; vwc: number | null; tempC: number | null }[]>`
        select to_char((ts at time zone 'UTC') at time zone ${zone}, 'YYYY-MM-DD') as day, avg(vwc)::float as vwc, avg("tempC")::float as "tempC"
        from "SoilReading" where "deviceId" = ${shallow.id} and ts >= ${iso(from)}::timestamptz at time zone 'UTC' and ts <= ${iso(to)}::timestamptz at time zone 'UTC'
        group by 1 order by 1`
      : [],
    soundIds.length ? prisma.soundDetection.findFirst({ where: { deviceId: { in: soundIds }, test: false }, orderBy: { ts: "asc" }, select: { ts: true } }) : null,
    shallow ? prisma.soilReading.findFirst({ where: { deviceId: { in: soilDevices.map((d) => d.id) } }, orderBy: { ts: "asc" }, select: { ts: true } }) : null,
  ]);

  // the verdict per quarter: the newest computation of each dimension in that quarter, through the same rule as the place page
  const byPeriod = new Map<string, Map<string, (typeof readings)[number]>>();
  for (const r of readings) {
    const m = byPeriod.get(r.period) ?? new Map();
    if (!m.has(r.dimension)) m.set(r.dimension, r);
    byPeriod.set(r.period, m);
  }
  const periods: Period[] = [...byPeriod.entries()].map(([period, m]) => {
    const bounds = periodBounds(period) ?? [0, 0];
    const list = [...m.values()].map((r) => ({ dimension: r.dimension, direction: r.direction, confidence: r.confidence, maturity: r.maturity, evidence: (r.evidence as Record<string, unknown>) ?? {} }));
    const v = list.length === 7 ? verdict(list) : { verdict: "insufficient" as Verdict, reason: `${list.length} of 7 readings computed` };
    return { period, from: bounds[0], to: bounds[1], verdict: v.verdict, reason: v.reason, readings: list.map((r) => ({ dimension: r.dimension, direction: r.direction, confidence: r.confidence, maturity: r.maturity, note: typeof r.evidence.note === "string" ? r.evidence.note : null })) };
  }).sort((a, b) => a.from - b.from);

  const dayT = (day: string) => { const [y, m, d] = day.split("-").map(Number); return dayStart(Date.UTC(y, m - 1, d, 12), zone); };
  const north = place.centroidLat >= 0;
  const seasons: [number, number][] = [];
  for (let y = new Date(from).getUTCFullYear() - 1; y <= new Date(to).getUTCFullYear() + 1; y++) {
    const a = north ? Date.UTC(y, 3, 1) : Date.UTC(y, 9, 1), b = north ? Date.UTC(y, 9, 1) : Date.UTC(y + 1, 3, 1);
    if (b > from && a < to) seasons.push([Math.max(a, from), Math.min(b, to)]);
  }
  const firsts = [firstSound?.ts.getTime(), firstSoil?.ts.getTime()].filter((t): t is number => typeof t === "number");

  return {
    zone, now, from, to, range,
    periods, latest: periods.length ? periods[periods.length - 1] : null,
    sat: sat.map((s) => [s.date.getTime(), s.ndviMean] as [number, number]),
    satTotal, satSince: firstSat?.date.getTime() ?? null,
    seasons,
    sound: soundRows.map((r) => ({ t: dayT(r.day), species: r.species, detections: r.detections })),
    soil: soilRows.map((r) => ({ t: dayT(r.day), vwc: r.vwc, tempC: r.tempC, activity: r.vwc !== null && r.tempC !== null ? soilActivity(r.tempC, r.vwc, frame) : null })),
    soilDepthCm: shallow?.depthCm ?? null,
    optimumVwc,
    nodeSince: firsts.length ? Math.min(...firsts) : null,
  };
}
