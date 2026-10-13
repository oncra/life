// Exploratory companion to run.ts: the same stations and weather, several ways of turning dry days and showers into a
// yearly number, scored on two things at once: how still they stay where nothing changed (noise), and how far they
// separate permanent grass from maize at the same place and year range (signal). Used to choose the method; not run
// by the oracle.
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { morningStorage, median, type SoilObs } from "../../src/lib/soilwater";

const DATA = process.argv[2] ?? `${process.env.HOME}/scratch/twente`;
const meta = JSON.parse(readFileSync(new URL("./stations.json", import.meta.url), "utf8")) as { stations: Record<string, { lat: number; lon: number; use: string }>; knmi: Record<string, [number, number]> };
const H = 36e5, DAY = 864e5;
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
const DEPTHS = [10, 20, 40];
type Dry = { year: number; loss: number; et0: number; s: number };
type Wet = { year: number; gain: number; p: number; s: number };
const stations: Record<string, { use: string; setupYears: Set<number>; dry: Dry[]; wet: Wet[]; sAll: number[] }> = {};
for (const [name, st] of Object.entries(meta.stations)) {
  const txt = gunzipSync(readFileSync(join(DATA, "red", `${name}.csv.gz`))).toString().trim().split("\n").slice(1);
  const obs: SoilObs[] = []; const setupYears = new Set<number>();
  for (const l of txt) {
    const p = l.split(","); const ts = Date.parse(p[0] + ":00Z");
    for (let i = 0; i < 3; i++) if (p[1 + i] !== "" && p[5 + i] === "0") obs.push({ ts, depthCm: DEPTHS[i], vwc: Number(p[1 + i]) * 100 });
    const m = new Date(ts).getUTCMonth() + 1;
    if ([p[8], p[9], p[10]].some((x) => x === "2" || x === "3" || x === "4")) setupYears.add(new Date(ts).getUTCFullYear() + (m >= 11 ? 1 : 0));
  }
  const ks = Object.entries(meta.knmi).sort((a, b) => dist([st.lat, st.lon], a[1]) - dist([st.lat, st.lon], b[1]))[0][0];
  const hrs = hourly.get(ks)!, e = ev.get(ks)!;
  const rain = (a: number, b: number) => { let t = 0; for (let h = Math.floor(a / H) * H; h < b; h += H) { const v = hrs.get(h); if (v === undefined || v === null) return null; t += v * ((Math.min(h + H, b) - Math.max(h, a)) / H); } return t; };
  const S = morningStorage(obs, st.lat, st.lon);
  const dry: Dry[] = [], wet: Wet[] = [], sAll: number[] = [];
  for (const [day, a] of S) {
    const b = S.get(day + DAY); if (!b) continue;
    const d = new Date(day); const m = d.getUTCMonth() + 1, year = d.getUTCFullYear();
    if (m >= 4 && m <= 9) sAll.push(a.s);
    const during = rain(a.t, b.t); if (during === null) continue;
    const et0 = e.get(day);
    if (m >= 4 && m <= 9) { const before = rain(a.t - 48 * H, a.t); if (before !== null && before + during <= 0.3 && et0 && et0 >= 1) dry.push({ year, loss: a.s - b.s, et0, s: a.s }); }
    if (m >= 4 && m <= 10 && during >= 5) { const before = rain(a.t - 24 * H, a.t); if (before !== null && before <= 1) wet.push({ year, gain: b.s - a.s, p: during, s: a.s }); }
  }
  stations[name] = { use: st.use, setupYears, dry, wet, sAll };
}
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
type Variant = (st: (typeof stations)[string], year: number) => number | null;
const variants: Record<string, Variant> = {
  U_medianRatio: (st, y) => { const v = st.dry.filter((d) => d.year === y).map((d) => d.loss / d.et0); return v.length >= 10 ? median(v) : null; },
  U_ratioOfSums: (st, y) => { const v = st.dry.filter((d) => d.year === y); return v.length >= 10 ? v.reduce((a, d) => a + d.loss, 0) / v.reduce((a, d) => a + d.et0, 0) : null; },
  U_midWet: (st, y) => { const lo = pct(st.sAll, 0.3), hi = pct(st.sAll, 0.9); const v = st.dry.filter((d) => d.year === y && d.s >= lo && d.s <= hi).map((d) => d.loss / d.et0); return v.length >= 8 ? median(v) : null; },
  U_wetHalf: (st, y) => { const lo = pct(st.sAll, 0.5); const v = st.dry.filter((d) => d.year === y && d.s >= lo).map((d) => d.loss / d.et0); return v.length >= 8 ? median(v) : null; },
  H_medianRatio: (st, y) => { const v = st.wet.filter((d) => d.year === y).map((d) => d.gain / d.p); return v.length >= 4 ? median(v) : null; },
  H_ratioOfSums: (st, y) => { const v = st.wet.filter((d) => d.year === y); return v.length >= 4 ? v.reduce((a, d) => a + d.gain, 0) / v.reduce((a, d) => a + d.p, 0) : null; },
  H_roomShare: (st, y) => { const top = pct(st.sAll, 0.95); const v = st.wet.filter((d) => d.year === y && top - d.s > 3).map((d) => d.gain / Math.min(d.p, top - d.s)); return v.length >= 4 ? median(v) : null; },
};
const out: Record<string, unknown> = {};
for (const [vn, f] of Object.entries(variants)) {
  // per station-year values
  const vals: Record<string, Record<number, number>> = {};
  for (const [n, st] of Object.entries(stations)) {
    vals[n] = {};
    for (let y = 2009; y <= 2020; y++) { if (st.setupYears.has(y)) continue; const v = f(st, y); if (v !== null && Number.isFinite(v)) vals[n][y] = v; }
  }
  // noise: stable pairs, change in units of the metric, for block sizes 1, 2 and 3 years
  const noise: Record<string, { n: number; sd: number; p90: number }> = {};
  for (const k of [1, 2, 3]) {
    const diffs: number[] = [];
    for (const [n, st] of Object.entries(stations)) {
      const v = vals[n];
      for (let y = 2009 + 2 * k - 1; y <= 2020; y++) {
        const recent = Array.from({ length: k }, (_, i) => y - i), prior = Array.from({ length: k }, (_, i) => y - k - i);
        const yrs = [...recent, ...prior];
        if (yrs.some((x) => v[x] === undefined || st.use[x - 2009] !== st.use[y - 2009] || st.use[x - 2009] === "-")) continue;
        diffs.push(recent.reduce((a, x) => a + v[x], 0) / k - prior.reduce((a, x) => a + v[x], 0) / k);
      }
    }
    const sd = Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / Math.max(1, diffs.length));
    noise[`block${k}`] = { n: diffs.length, sd: Math.round(sd * 1000) / 1000, p90: Math.round(pct(diffs.map(Math.abs), 0.9) * 1000) / 1000 };
  }
  // signal: grass versus maize station-years (same period, all stations)
  const g: number[] = [], m: number[] = [], c: number[] = [];
  for (const [n, st] of Object.entries(stations)) for (const [y, v] of Object.entries(vals[n])) { const u = st.use[Number(y) - 2009]; if (u === "g") g.push(v); if (u === "m") m.push(v); if (u === "c") c.push(v); }
  const all = Object.values(vals).flatMap((v) => Object.values(v));
  out[vn] = { median: Math.round(median(all) * 1000) / 1000, grass: { n: g.length, median: Math.round(median(g) * 1000) / 1000 }, maize: { n: m.length, median: Math.round(median(m) * 1000) / 1000 }, cereal: { n: c.length, median: c.length ? Math.round(median(c) * 1000) / 1000 : null }, noise, signalToNoise1y: Math.round(((median(g) - median(m)) / noise.block1.sd) * 100) / 100, signalToNoise2y: Math.round(((median(g) - median(m)) / noise.block2.sd) * 100) / 100, signalToNoise3y: Math.round(((median(g) - median(m)) / noise.block3.sd) * 100) / 100 };
}
console.log(JSON.stringify(out, null, 1));
