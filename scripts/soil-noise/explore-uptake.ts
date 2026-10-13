// Second exploratory pass on the uptake number only (the held share showed no difference between grass and maize):
// which choices of dry day, season, layer and reference keep it stillest where nothing changed while keeping the
// grass-maize difference. Not run by the oracle.
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
const rainAt = (st: string, a: number, b: number) => { const hrs = hourly.get(st)!; let t = 0; for (let h = Math.floor(a / H) * H; h < b; h += H) { const v = hrs.get(h); if (v === undefined || v === null) return null; t += v * ((Math.min(h + H, b) - Math.max(h, a)) / H); } return t; };
const DEPTHS = [10, 20, 40];
type Cfg = { name: string; dryMm: number; dryH: number; allStations: boolean; months: [number, number]; minEt0: number; layer: "both" | "upper" | "lower"; minDays: number };
const base: Cfg = { name: "base", dryMm: 0.3, dryH: 48, allStations: false, months: [4, 9], minEt0: 1, layer: "both", minDays: 10 };
const cfgs: Cfg[] = [
  base,
  { ...base, name: "dry at all three KNMI stations", allStations: true },
  { ...base, name: "dry <= 1 mm", dryMm: 1 },
  { ...base, name: "dry 72 h", dryH: 72 },
  { ...base, name: "dry 24 h", dryH: 24 },
  { ...base, name: "May-Aug", months: [5, 8] },
  { ...base, name: "ET0 >= 2 mm", minEt0: 2 },
  { ...base, name: "upper layer only (10 cm)", layer: "upper" },
  { ...base, name: "lower layer only (20-40 cm)", layer: "lower" },
  { ...base, name: "min 20 days", minDays: 20 },
];
// load once
const obsBy: Record<string, { obs: SoilObs[]; setupYears: Set<number>; ks: string; lat: number; lon: number; use: string }> = {};
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
  obsBy[name] = { obs, setupYears, ks, lat: st.lat, lon: st.lon, use: st.use };
}
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const rows: unknown[] = [];
for (const cfg of cfgs) {
  const vals: Record<string, Record<number, number>> = {};
  for (const [name, s] of Object.entries(obsBy)) {
    const obs = cfg.layer === "both" ? s.obs : s.obs.filter((o) => (cfg.layer === "upper" ? o.depthCm <= 15 : o.depthCm > 15));
    const S = morningStorage(cfg.layer === "lower" ? obs.map((o) => ({ ...o, depthCm: 10 })) : obs, s.lat, s.lon);
    const e = ev.get(s.ks)!;
    const per = new Map<number, number[]>();
    for (const [day, a] of S) {
      const b = S.get(day + DAY); if (!b) continue;
      const d = new Date(day), m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
      if (m < cfg.months[0] || m > cfg.months[1] || s.setupYears.has(y)) continue;
      const et0 = e.get(day); if (!et0 || et0 < cfg.minEt0) continue;
      const sts = cfg.allStations ? Object.keys(meta.knmi) : [s.ks];
      let dry = true;
      for (const k of sts) { const r = rainAt(k, a.t - cfg.dryH * H, b.t); if (r === null || r > cfg.dryMm) { dry = false; break; } }
      if (!dry) continue;
      per.set(y, [...(per.get(y) ?? []), (a.s - b.s) / et0]);
    }
    vals[name] = {};
    for (const [y, v] of per) if (v.length >= cfg.minDays) vals[name][y] = median(v);
  }
  const noise = (k: number, crowd: boolean) => {
    const crowdOf = (y: number, self: string, use: string) => { const v = Object.entries(vals).filter(([n]) => n !== self && obsBy[n].use[y - 2009] === use).map(([, x]) => x[y]).filter((x) => x !== undefined); return v.length >= 4 ? median(v) : undefined; };
    const diffs: number[] = [];
    for (const [n, v] of Object.entries(vals)) {
      const use = obsBy[n].use;
      for (let y = 2009 + 2 * k - 1; y <= 2020; y++) {
        const yrs = Array.from({ length: 2 * k }, (_, i) => y - i);
        if (yrs.some((x) => v[x] === undefined || use[x - 2009] !== use[y - 2009] || use[x - 2009] === "-")) continue;
        const val = (x: number) => { if (!crowd) return v[x]; const c = crowdOf(x, n, use[x - 2009]); return c === undefined ? NaN : v[x] - c; };
        const recent = yrs.slice(0, k).map(val), prior = yrs.slice(k).map(val);
        const d = recent.reduce((a, b) => a + b, 0) / k - prior.reduce((a, b) => a + b, 0) / k;
        if (Number.isFinite(d)) diffs.push(d);
      }
    }
    return { n: diffs.length, sd: r3(Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / Math.max(1, diffs.length))), p90: diffs.length ? r3(pct(diffs.map(Math.abs), 0.9)) : null };
  };
  const g: number[] = [], m: number[] = [];
  for (const [n, v] of Object.entries(vals)) for (const [y, x] of Object.entries(v)) { const u = obsBy[n].use[Number(y) - 2009]; if (u === "g") g.push(x); if (u === "m") m.push(x); }
  const n1 = noise(1, false), n2 = noise(2, false), c1 = noise(1, true), c2 = noise(2, true);
  rows.push({ cfg: cfg.name, years: Object.values(vals).reduce((a, v) => a + Object.keys(v).length, 0), grass: r3(median(g)), maize: r3(median(m)), diff: r3(median(g) - median(m)), noise1y: n1, noise2y: n2, crowd1y: c1, crowd2y: c2, sn1: r3((median(g) - median(m)) / n1.sd), sn2: r3((median(g) - median(m)) / n2.sd), snCrowd1: r3((median(g) - median(m)) / c1.sd) });
}
console.log(JSON.stringify(rows, null, 1));
