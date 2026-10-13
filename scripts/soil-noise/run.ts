/**
 * How much does the Cycling water-loop number (src/lib/soilwater.ts) move from one year to the next where nothing
 * changed, and does it tell permanent grass from maize? The first sets the thresholds, the second says whether the
 * number sees living cover at all (content/soil-water.md, content/spec.md 3.5).
 *
 * Data: the Twente soil moisture network (20 stations in the east of the Netherlands, 2009-2020, 15-minute readings at
 * 5 to 80 cm with quality and setup flags; van der Velde et al. 2023, doi 10.5194/essd-15-1889-2023; data
 * doi 10.17026/dans-znj-wyg5, CC BY 4.0) and KNMI hourly rain and daily Makkink reference evaporation from the
 * nearest of Twenthe, Hupsel and Heino. Each station is read the way a Life node reads its probes, through the same
 * functions the oracle runs: only the first hour of the core listening window counts.
 *
 *   python3 scripts/soil-noise/reduce_twente.py              # streams the station files into ~/scratch/twente/red
 *   scripts/soil-noise/fetch-knmi.sh ~/scratch/twente/knmi    # KNMI hourly rain and daily EV24, 2008-2020
 *   npx tsx scripts/soil-noise/run.ts ~/scratch/twente        # prints the result as JSON
 *
 * explore.ts and explore-uptake.ts run the same data through other choices (ratio of sums, wet days only, the dry-day
 * rule, season, layer, a fixed wetness), green-fetch.ts and green.ts test the number per unit of green cover from
 * Sentinel-2; they are the record of how the method was chosen and are not run by the oracle.
 */
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { morningStorage, soilWaterYears, median, SOIL_WATER, type SoilObs, type WeatherDayIn } from "../../src/lib/soilwater";

const DATA = process.argv[2] ?? `${process.env.HOME}/scratch/twente`;
const meta = JSON.parse(readFileSync(new URL("./stations.json", import.meta.url), "utf8")) as {
  stations: Record<string, { lat: number; lon: number; use: string }>;
  knmi: Record<string, [number, number]>;
};
const H = 36e5, DAY = 864e5, FIRST = 2009;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

// ---- KNMI ----
const hourly = new Map<string, Map<number, number | null>>();
for (const f of readdirSync(join(DATA, "knmi")).filter((f) => f.startsWith("h_"))) {
  const st = f.split("_")[1];
  const m = hourly.get(st) ?? new Map();
  for (const r of JSON.parse(readFileSync(join(DATA, "knmi", f), "utf8")) as { date: string; hour: number; RH: number | null }[]) {
    m.set(Date.parse(r.date) + (r.hour - 1) * H, r.RH === null || r.RH === undefined ? null : r.RH < 0 ? 0 : r.RH / 10); // hour 1 is 00-01 UT; -1 is under 0.05 mm
  }
  hourly.set(st, m);
}
const daily = new Map<string, Map<number, number | null>>();
for (const r of JSON.parse(readFileSync(join(DATA, "knmi", "daily.json"), "utf8")) as { station_code: number; date: string; EV24: number | null }[]) {
  const m = daily.get(String(r.station_code)) ?? new Map();
  m.set(Date.parse(r.date), r.EV24 === null || r.EV24 === undefined ? null : r.EV24 / 10);
  daily.set(String(r.station_code), m);
}
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180));
const nearest = (lat: number, lon: number) => Object.entries(meta.knmi).sort((x, y) => dist([lat, lon], x[1]) - dist([lat, lon], y[1]))[0][0];
function weather(station: string): WeatherDayIn[] {
  const hrs = hourly.get(station)!, ev = daily.get(station)!;
  return [...ev].map(([day, et0]) => ({ day, et0, rainHourly: Array.from({ length: 24 }, (_, i) => hrs.get(day + i * H) ?? null) }));
}

// ---- stations, read as a node reads its probes ----
const DEPTHS = [10, 20, 40];
type St = { use: string; setupYears: Set<number>; uptake: Record<number, number>; held: Record<number, number> };
const st: Record<string, St> = {};
for (const [name, s] of Object.entries(meta.stations)) {
  const lines = gunzipSync(readFileSync(join(DATA, "red", `${name}.csv.gz`))).toString("utf8").trim().split("\n").slice(1);
  const obs: SoilObs[] = [];
  const setupYears = new Set<number>(); // a sensor replaced or moved: that season is not compared with anything
  for (const l of lines) {
    const p = l.split(",");
    const ts = Date.parse(p[0] + ":00Z");
    for (let i = 0; i < 3; i++) if (p[1 + i] !== "" && p[5 + i] === "0") obs.push({ ts, depthCm: DEPTHS[i], vwc: Number(p[1 + i]) * 100 });
    if ([p[8], p[9], p[10]].some((m) => m === "2" || m === "3" || m === "4")) {
      const d = new Date(ts);
      setupYears.add(d.getUTCFullYear() + (d.getUTCMonth() >= 10 ? 1 : 0)); // a change in November or December belongs to the next season
    }
  }
  const k = nearest(s.lat, s.lon);
  const uptake: Record<number, number> = {};
  for (const y of soilWaterYears(obs, weather(k), s.lat, s.lon)) if (y.uptake !== null && !setupYears.has(y.year)) uptake[y.year] = y.uptake;
  // the candidate that was left out: the share of a shower (5 mm or more, dry 24 h before) still held the next morning
  const S = morningStorage(obs, s.lat, s.lon);
  const hrs = hourly.get(k)!;
  const rain = (a: number, b: number) => { let t = 0; for (let h = Math.floor(a / H) * H; h < b; h += H) { const v = hrs.get(h); if (v === undefined || v === null) return null; t += v * ((Math.min(h + H, b) - Math.max(h, a)) / H); } return t; };
  const heldBy = new Map<number, number[]>();
  for (const [day, a] of S) {
    const b = S.get(day + DAY); if (!b) continue;
    const d = new Date(day), m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
    if (m < 4 || m > 10) continue;
    const during = rain(a.t, b.t), before = rain(a.t - 24 * H, a.t);
    if (during === null || before === null || during < 5 || before > 1) continue;
    heldBy.set(y, [...(heldBy.get(y) ?? []), (b.s - a.s) / during]);
  }
  const held: Record<number, number> = {};
  for (const [y, v] of heldBy) if (v.length >= 4 && !setupYears.has(y)) held[y] = r3(median(v));
  st[name] = { use: s.use, setupYears, uptake, held };
}

// ---- noise: change between blocks of k seasons at a station whose land use stayed the same ----
function noise(metric: "uptake" | "held", k: number, crowd = false) {
  const crowdOf = (y: number, self: string, use: string) => {
    const v = Object.entries(st).filter(([n, s]) => n !== self && s.use[y - FIRST] === use).map(([, s]) => s[metric][y]).filter((x) => x !== undefined);
    return v.length >= 4 ? median(v) : undefined;
  };
  const diffs: number[] = [];
  for (const [n, s] of Object.entries(st)) {
    for (let y = FIRST + 2 * k - 1; y <= 2020; y++) {
      const yrs = Array.from({ length: 2 * k }, (_, i) => y - i);
      if (yrs.some((x) => s[metric][x] === undefined || s.use[x - FIRST] !== s.use[y - FIRST] || s.use[x - FIRST] === "-")) continue;
      const val = (x: number) => (crowd ? s[metric][x] - (crowdOf(x, n, s.use[x - FIRST]) ?? NaN) : s[metric][x]);
      const d = yrs.slice(0, k).reduce((a, x) => a + val(x), 0) / k - yrs.slice(k).reduce((a, x) => a + val(x), 0) / k;
      if (Number.isFinite(d)) diffs.push(d);
    }
  }
  const sd = Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / Math.max(1, diffs.length));
  return { pairs: diffs.length, sd: r3(sd), p80: r3(pct(diffs.map(Math.abs), 0.8)), p90: r3(pct(diffs.map(Math.abs), 0.9)), p95: r3(pct(diffs.map(Math.abs), 0.95)) };
}
function levels(metric: "uptake" | "held") {
  const by: Record<string, number[]> = {};
  for (const s of Object.values(st)) for (const [y, v] of Object.entries(s[metric])) (by[s.use[Number(y) - FIRST]] ??= []).push(v);
  return Object.fromEntries(Object.entries(by).filter(([u]) => u !== "-").map(([u, v]) => [u, { seasons: v.length, median: r3(median(v)), p25: r3(pct(v, 0.25)), p75: r3(pct(v, 0.75)) }]));
}
const out = {
  rules: SOIL_WATER,
  stations: Object.keys(st).length,
  seasons: { uptake: Object.values(st).reduce((n, s) => n + Object.keys(s.uptake).length, 0), held: Object.values(st).reduce((n, s) => n + Object.keys(s.held).length, 0) },
  uptake: { byLandUse: levels("uptake"), noiseOneYear: noise("uptake", 1), noiseTwoYears: noise("uptake", 2), noiseThreeYears: noise("uptake", 3), noiseOneYearAgainstCrowd: noise("uptake", 1, true) },
  held: { byLandUse: levels("held"), noiseOneYear: noise("held", 1), noiseTwoYears: noise("held", 2) },
  perStation: Object.fromEntries(Object.entries(st).map(([n, s]) => [n, { use: s.use, uptake: s.uptake, held: s.held, setupSeasons: [...s.setupYears].sort() }])),
};
console.log(JSON.stringify(out, null, 1));
