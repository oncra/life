/**
 * Weather at a place for the Cycling water loop (src/lib/soilwater.ts): rain per hour and Makkink reference
 * evaporation per day, from the nearest KNMI automatic weather station that measures both (open data, no key:
 * https://www.daggegevens.knmi.nl). Stored per UTC day in WeatherDay; only places with a soil probe get rows.
 * Outside the Netherlands there is no station within reach and the water loop says so; ERA5-Land is specified.
 */
import { prisma } from "./db";

const KNMI = "https://www.daggegevens.knmi.nl/klimatologie";
const DAY = 864e5;
/** farther than this from every KNMI station measuring rain and evaporation: no weather source */
export const MAX_STATION_KM = 40;

export interface KnmiStation { code: string; lat: number; lon: number; name: string }

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
async function post(path: string, body: Record<string, string>): Promise<string> {
  const r = await fetch(`${KNMI}/${path}`, { method: "POST", body: new URLSearchParams(body), signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`knmi ${path} ${r.status}`);
  return r.text();
}

let stationCache: { at: number; list: KnmiStation[] } | null = null;
/** Stations that reported both evaporation and rain a week ago (the text answer lists every station in its header). */
export async function knmiStations(now = Date.now()): Promise<KnmiStation[]> {
  if (stationCache && now - stationCache.at < 7 * DAY) return stationCache.list;
  const day = ymd(now - 7 * DAY);
  const txt = await post("daggegevens", { start: day, end: day, vars: "EV24:RH", stns: "ALL" });
  const all = new Map<string, KnmiStation>();
  const measuring = new Set<string>();
  for (const line of txt.split("\n")) {
    const h = /^#\s+(\d{3})\s+([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)\s+(.+?)\s*$/.exec(line);
    if (h) { all.set(h[1], { code: h[1], lon: Number(h[2]), lat: Number(h[3]), name: h[5] }); continue; }
    const d = line.split(",").map((x) => x.trim());
    if (d.length >= 4 && /^\d{3}$/.test(d[0]) && d[2] !== "" && d[3] !== "") measuring.add(d[0]);
  }
  const list = [...all.values()].filter((s) => measuring.has(s.code));
  stationCache = { at: now, list };
  return list;
}

export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371;
}

export async function nearestStation(lat: number, lon: number): Promise<(KnmiStation & { km: number }) | null> {
  const best = (await knmiStations()).map((s) => ({ ...s, km: km({ lat, lon }, s) })).sort((a, b) => a.km - b.km)[0];
  return best && best.km <= MAX_STATION_KM ? best : null;
}

/** KNMI hourly rain and daily evaporation for one station, UTC days [from, to], as WeatherDay rows (without placeId). */
export async function knmiDays(code: string, from: number, to: number) {
  const hourly = JSON.parse(await post("uurgegevens", { start: `${ymd(from)}01`, end: `${ymd(to)}24`, vars: "RH", stns: code, fmt: "json" })) as { date: string; hour: number; RH: number | null }[];
  const daily = JSON.parse(await post("daggegevens", { start: ymd(from), end: ymd(to), vars: "EV24", stns: code, fmt: "json" })) as { date: string; EV24: number | null }[];
  const rain = new Map<number, (number | null)[]>();
  for (const h of hourly) {
    const day = Date.parse(h.date);
    const row = rain.get(day) ?? Array<number | null>(24).fill(null);
    // hour 1 is 00:00-01:00 UT; RH is in 0.1 mm, -1 means under 0.05 mm
    row[h.hour - 1] = h.RH === null || h.RH === undefined ? null : h.RH < 0 ? 0 : h.RH / 10;
    rain.set(day, row);
  }
  return daily.map((d) => {
    const day = Date.parse(d.date);
    return { day: new Date(day), rainHourly: rain.get(day) ?? Array<number | null>(24).fill(null), et0: d.EV24 === null || d.EV24 === undefined ? null : d.EV24 / 10, source: `knmi:${code}` };
  });
}

/** Fill WeatherDay for every placed place with a soil probe, from three days before its first soil reading to
 *  yesterday, a year per request; the last three stored days are fetched again, since KNMI completes a day's hours
 *  after the day. Returns the number of days stored. */
export async function weatherSweep(log: (...a: unknown[]) => void, now = Date.now()): Promise<number> {
  const places = await prisma.place.findMany({ where: { placed: true, devices: { some: { kind: "SOIL" } } }, select: { id: true, slug: true, centroidLat: true, centroidLon: true } });
  const yesterday = Math.floor(now / DAY) * DAY - DAY;
  let stored = 0;
  for (const p of places) {
    const station = await nearestStation(p.centroidLat, p.centroidLon);
    if (!station) continue;
    const last = await prisma.weatherDay.findFirst({ where: { placeId: p.id }, orderBy: { day: "desc" }, select: { day: true } });
    const first = await prisma.soilReading.findFirst({ where: { device: { placeId: p.id } }, orderBy: { ts: "asc" }, select: { ts: true } });
    if (!first) continue;
    let from = last ? last.day.getTime() - 2 * DAY : Math.floor(first.ts.getTime() / DAY) * DAY - 3 * DAY;
    while (from <= yesterday) {
      const to = Math.min(yesterday, from + 364 * DAY);
      const days = await knmiDays(station.code, from, to);
      for (const d of days) {
        await prisma.weatherDay.upsert({
          where: { placeId_day: { placeId: p.id, day: d.day } },
          create: { placeId: p.id, ...d, rainHourly: d.rainHourly as object },
          update: { rainHourly: d.rainHourly as object, et0: d.et0, source: d.source },
        });
      }
      stored += days.length;
      from = to + DAY;
    }
    if (stored) log(`weather ${p.slug}: KNMI ${station.code} ${station.name} (${station.km.toFixed(0)} km)`);
  }
  return stored;
}
