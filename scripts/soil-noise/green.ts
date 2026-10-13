/**
 * The water loop per unit of green: does dividing the dry-day uptake (src/lib/soilwater.ts) by the green cover on the
 * same day, from Sentinel-2, make the number stiller where nothing changed? Mowing, grazing and the stage of the crop
 * move the canopy; what remains after dividing by it is how much water the roots draw from the top 40 cm for the green
 * that is there. Twente stations, 2018-2020, the seasons with Sentinel-2 L2A at Earth Search (green-fetch.ts first). Prints JSON; summarised in content/soil-water.md.
 *
 * Green cover from NDVI, linear between bare soil (0.15) and full cover (0.85), floored at 0.1. NDVI between clear
 * scenes is interpolated when they are at most 20 days apart; a scene more than 0.15 under the line between its two
 * neighbours is taken as cloud or shadow the scene classification missed and dropped.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { morningStorage, median, SOIL_WATER, type SoilObs } from "../../src/lib/soilwater";

const DATA = process.argv[2] ?? `${process.env.HOME}/scratch/twente`;
const meta = JSON.parse(readFileSync(new URL("./stations.json", import.meta.url), "utf8")) as { stations: Record<string, { lat: number; lon: number; use: string }>; knmi: Record<string, [number, number]> };
const H = 36e5, DAY = 864e5, FIRST = 2009, Y0 = 2018, Y1 = 2020; // Earth Search has Sentinel-2 L2A from 2018 here
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

const hourly = new Map<string, Map<number, number | null>>();
for (const f of readdirSync(join(DATA, "knmi")).filter((f) => f.startsWith("h_"))) {
  const st = f.split("_")[1]; const m = hourly.get(st) ?? new Map();
  for (const r of JSON.parse(readFileSync(join(DATA, "knmi", f), "utf8")) as { date: string; hour: number; RH: number | null }[]) m.set(Date.parse(r.date) + (r.hour - 1) * H, r.RH === null ? null : r.RH < 0 ? 0 : r.RH / 10);
  hourly.set(st, m);
}
const ev = new Map<string, Map<number, number | null>>();
for (const r of JSON.parse(readFileSync(join(DATA, "knmi", "daily.json"), "utf8")) as { station_code: number; date: string; EV24: number | null }[]) {
  const m = ev.get(String(r.station_code)) ?? new Map(); m.set(Date.parse(r.date), r.EV24 === null ? null : r.EV24 / 10); ev.set(String(r.station_code), m);
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.61);

/** daily NDVI from clear scenes: dip filter, then linear interpolation over gaps of at most 20 days */
function dailyNdvi(rows: { date: string; ndvi: number }[]): Map<number, number> {
  let pts = rows.map((r) => ({ t: Math.floor(Date.parse(r.date) / DAY) * DAY, v: r.ndvi }));
  // one value per day (two tiles can cover a station on the same day)
  const byDay = new Map<number, number[]>(); for (const p of pts) byDay.set(p.t, [...(byDay.get(p.t) ?? []), p.v]);
  pts = [...byDay].map(([t, v]) => ({ t, v: Math.max(...v) })).sort((a, b) => a.t - b.t);
  const keep = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1], b = pts[i + 1];
    const line = a.v + ((b.v - a.v) * (p.t - a.t)) / (b.t - a.t);
    return p.v >= line - 0.15;
  });
  const out = new Map<number, number>();
  for (let i = 0; i < keep.length - 1; i++) {
    const a = keep[i], b = keep[i + 1];
    if (b.t - a.t > 20 * DAY) { out.set(a.t, a.v); continue; }
    for (let t = a.t; t < b.t; t += DAY) out.set(t, a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t));
  }
  if (keep.length) out.set(keep[keep.length - 1].t, keep[keep.length - 1].v);
  return out;
}
const cover = (ndvi: number) => Math.min(1, Math.max(0.1, (ndvi - 0.15) / 0.7));

type Val = { raw?: number; green?: number; ndvi?: number; days: number };
const st: Record<string, { use: string; vals: Record<number, Val> }> = {};
const DEPTHS = [10, 20, 40];
for (const [name, s] of Object.entries(meta.stations)) {
  const nf = join(DATA, "ndvi", `${name}.json`);
  if (!existsSync(nf)) continue;
  const nd = dailyNdvi((JSON.parse(readFileSync(nf, "utf8")) as { rows: { date: string; ndvi: number }[] }).rows);
  const lines = gunzipSync(readFileSync(join(DATA, "red", `${name}.csv.gz`))).toString().trim().split("\n").slice(1);
  const obs: SoilObs[] = []; const setupYears = new Set<number>();
  for (const l of lines) {
    const p = l.split(","); const ts = Date.parse(p[0] + ":00Z");
    if (new Date(ts).getUTCFullYear() < Y0 - 1) continue;
    for (let i = 0; i < 3; i++) if (p[1 + i] !== "" && p[5 + i] === "0") obs.push({ ts, depthCm: DEPTHS[i], vwc: Number(p[1 + i]) * 100 });
    if ([p[8], p[9], p[10]].some((m) => m === "2" || m === "3" || m === "4")) { const d = new Date(ts); setupYears.add(d.getUTCFullYear() + (d.getUTCMonth() >= 10 ? 1 : 0)); }
  }
  const ks = Object.entries(meta.knmi).sort((a, b) => dist([s.lat, s.lon], a[1]) - dist([s.lat, s.lon], b[1]))[0][0];
  const hrs = hourly.get(ks)!, e = ev.get(ks)!;
  const rain = (a: number, b: number) => { let t = 0; for (let h = Math.floor(a / H) * H; h < b; h += H) { const v = hrs.get(h); if (v === undefined || v === null) return null; t += v * ((Math.min(h + H, b) - Math.max(h, a)) / H); } return t; };
  const S = morningStorage(obs, s.lat, s.lon);
  const raw = new Map<number, number[]>(), green = new Map<number, number[]>(), nv = new Map<number, number[]>();
  for (const [day, a] of S) {
    const b = S.get(day + DAY); if (!b) continue;
    const d = new Date(day), m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
    if (y < Y0 || y > Y1 || m < 4 || m > 9 || setupYears.has(y)) continue;
    const et0 = e.get(day); if (!et0 || et0 < SOIL_WATER.uptakeMinEt0) continue;
    const r = rain(a.t - 48 * H, b.t); if (r === null || r > SOIL_WATER.uptakeDryMm) continue;
    const n = nd.get(day); if (n === undefined) continue; // only days with greenness, so raw and green see the same days
    const u = (a.s - b.s) / et0;
    raw.set(y, [...(raw.get(y) ?? []), u]); green.set(y, [...(green.get(y) ?? []), u / cover(n)]); nv.set(y, [...(nv.get(y) ?? []), n]);
  }
  const vals: Record<number, Val> = {};
  for (const [y, v] of raw) if (v.length >= SOIL_WATER.uptakeMinDays) vals[y] = { raw: median(v), green: median(green.get(y)!), ndvi: median(nv.get(y)!), days: v.length };
  st[name] = { use: s.use, vals };
}

function noise(k: "raw" | "green" | "ndvi") {
  const diffs: number[] = [];
  for (const s of Object.values(st)) for (let y = Y0 + 1; y <= Y1; y++) {
    const a = s.vals[y - 1]?.[k], b = s.vals[y]?.[k];
    if (a === undefined || b === undefined || s.use[y - FIRST] !== s.use[y - 1 - FIRST] || s.use[y - FIRST] === "-") continue;
    diffs.push(b - a);
  }
  return { pairs: diffs.length, sd: r3(Math.sqrt(diffs.reduce((x, d) => x + d * d, 0) / Math.max(1, diffs.length))), p90: r3(pct(diffs.map(Math.abs), 0.9)) };
}
/** share of the variance that lies between stations (one-way ICC on station seasons with the same land use all along) */
function icc(k: "raw" | "green" | "ndvi") {
  const groups = Object.values(st).map((s) => Object.entries(s.vals).filter(([y]) => s.use[Number(y) - FIRST] === "g").map(([, v]) => v[k]!)).filter((g) => g.length >= 2);
  const all = groups.flat(); const grand = all.reduce((a, b) => a + b, 0) / all.length;
  const n0 = all.length / groups.length;
  const msb = groups.reduce((a, g) => a + g.length * (g.reduce((x, y) => x + y, 0) / g.length - grand) ** 2, 0) / (groups.length - 1);
  const msw = groups.reduce((a, g) => { const m = g.reduce((x, y) => x + y, 0) / g.length; return a + g.reduce((x, y) => x + (y - m) ** 2, 0); }, 0) / (all.length - groups.length);
  return { stations: groups.length, icc: r3((msb - msw) / (msb + (n0 - 1) * msw)) };
}
function byUse(k: "raw" | "green" | "ndvi") {
  const by: Record<string, number[]> = {};
  for (const s of Object.values(st)) for (const [y, v] of Object.entries(s.vals)) (by[s.use[Number(y) - FIRST]] ??= []).push(v[k]!);
  return Object.fromEntries(Object.entries(by).filter(([u]) => u !== "-").map(([u, v]) => [u, { seasons: v.length, median: r3(median(v)) }]));
}
const res = Object.fromEntries((["raw", "green", "ndvi"] as const).map((k) => [k, { byUse: byUse(k), noise: noise(k), icc: icc(k) }]));
console.log(JSON.stringify({ stations: Object.keys(st).length, seasons: Object.values(st).reduce((n, s) => n + Object.keys(s.vals).length, 0), ...res, perStation: Object.fromEntries(Object.entries(st).map(([n, s]) => [n, Object.fromEntries(Object.entries(s.vals).map(([y, v]) => [y, { raw: r3(v.raw!), green: r3(v.green!), ndvi: r3(v.ndvi!), days: v.days }]))])) }, null, 1));
