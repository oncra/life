/**
 * Turning raw streams into the seven readings.
 * Every function is deliberately simple and documented; the method is the product.
 * Returns UNKNOWN with an explanation whenever the evidence is not there.
 */
import type { Dimension, Direction } from "@/generated/prisma/client";

export const DIMENSIONS: Dimension[] = ["PRODUCTIVITY", "DIVERSITY", "STRUCTURE", "RENEWAL", "CYCLING", "RESILIENCE", "AUTONOMY"];

export interface ReadingOut {
  dimension: Dimension;
  direction: Direction;
  confidence: number; // 0..1
  maturity: number; // periods the direction has held
  evidence: Record<string, unknown>;
}

export interface SatPoint { date: Date; ndvi: number }
export interface DetPoint { ts: Date; species: string; confidence: number }
export interface IdxPoint { ts: Date; ndsi: number | null; anthrophony: number | null; biophony: number | null; adi: number | null }
export interface SoilPoint { ts: Date; depthCm: number; vwc: number | null; tempC: number | null }

const season = (lat: number, d: Date) => {
  const m = d.getUTCMonth() + 1;
  const north = lat >= 0;
  const growing = north ? m >= 4 && m <= 9 : m >= 10 || m <= 3;
  return { year: north ? d.getUTCFullYear() : m >= 10 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(), growing };
};

export function growingSeasonMeans(points: SatPoint[], lat: number): { year: number; mean: number; n: number }[] {
  const by = new Map<number, number[]>();
  for (const p of points) {
    const s = season(lat, p.date);
    if (!s.growing) continue;
    by.set(s.year, [...(by.get(s.year) ?? []), p.ndvi]);
  }
  return [...by.entries()]
    .map(([year, v]) => ({ year, mean: v.reduce((a, b) => a + b, 0) / v.length, n: v.length }))
    .sort((a, b) => a.year - b.year);
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export function productivity(points: SatPoint[], lat: number, currentYear: number): ReadingOut {
  const seasons = growingSeasonMeans(points, lat).filter((s) => s.n >= 4);
  const complete = seasons.filter((s) => s.year < currentYear || (s.year === currentYear && new Date().getUTCMonth() >= 9));
  if (complete.length < 3) {
    return { dimension: "PRODUCTIVITY", direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "need at least three growing seasons with four or more clear observations each", seasons } };
  }
  const last = complete[complete.length - 1];
  const prior = complete.slice(0, -1).slice(-3);
  const ref = median(prior.map((s) => s.mean));
  const delta = last.mean - ref;
  const direction: Direction = delta > 0.03 ? "RISING" : delta < -0.03 ? "FALLING" : "HOLDING";
  // confidence: observation density and number of seasons
  const density = Math.min(1, last.n / 10);
  const depth = Math.min(1, complete.length / 5);
  const confidence = Math.round(100 * (0.4 * density + 0.4 * depth + 0.2)) / 100;
  // maturity: consecutive seasons with same sign of delta against their own trailing median
  let maturity = 1;
  for (let i = complete.length - 2; i >= 2; i--) {
    const r = median(complete.slice(Math.max(0, i - 3), i).map((s) => s.mean));
    const d = complete[i].mean - r;
    const dir: Direction = d > 0.03 ? "RISING" : d < -0.03 ? "FALLING" : "HOLDING";
    if (dir === direction) maturity++; else break;
  }
  return { dimension: "PRODUCTIVITY", direction, confidence, maturity, evidence: { lastSeason: last, referenceMedian: ref, delta, seasons: complete } };
}

export function resilience(points: SatPoint[], lat: number): ReadingOut {
  const seasons = growingSeasonMeans(points, lat).filter((s) => s.n >= 4);
  if (seasons.length < 4) {
    return { dimension: "RESILIENCE", direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "need four or more growing seasons in the archive to detect shocks and recovery" } };
  }
  const ref = median(seasons.map((s) => s.mean));
  const shocks: { year: number; drop: number; recoveredIn: number | null }[] = [];
  for (let i = 0; i < seasons.length; i++) {
    const drop = (ref - seasons[i].mean) / Math.abs(ref || 1);
    if (drop > 0.15) {
      let recoveredIn: number | null = null;
      for (let j = i + 1; j < seasons.length; j++) {
        if (seasons[j].mean >= ref * 0.95) { recoveredIn = seasons[j].year - seasons[i].year; break; }
      }
      shocks.push({ year: seasons[i].year, drop, recoveredIn });
    }
  }
  if (shocks.length < 2) {
    return { dimension: "RESILIENCE", direction: "UNKNOWN", confidence: 0.2, maturity: 0, evidence: { note: "fewer than two shocks (>15% below the place's median) in the archive; resilience cannot be read yet", shocks, referenceMedian: ref } };
  }
  const a = shocks[shocks.length - 2], b = shocks[shocks.length - 1];
  let direction: Direction = "HOLDING";
  if (a.recoveredIn !== null && b.recoveredIn !== null) direction = b.recoveredIn < a.recoveredIn ? "RISING" : b.recoveredIn > a.recoveredIn ? "FALLING" : "HOLDING";
  else if (b.recoveredIn === null) direction = "FALLING";
  // low confidence until neighbours (the regional crowd) are in the comparison
  return { dimension: "RESILIENCE", direction, confidence: 0.4, maturity: 1, evidence: { shocks, referenceMedian: ref, note: "single-place estimate; neighbour comparison not yet applied" } };
}

export function diversity(dets: DetPoint[], currentYear: number): ReadingOut {
  if (dets.length === 0) return { dimension: "DIVERSITY", direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "no sound stream yet: install a recorder and deliver detections" } };
  const byYear = new Map<number, Set<string>>();
  for (const d of dets) if (d.confidence >= 0.7) byYear.set(d.ts.getUTCFullYear(), (byYear.get(d.ts.getUTCFullYear()) ?? new Set()).add(d.species));
  const years = [...byYear.keys()].sort();
  if (years.length < 2) return { dimension: "DIVERSITY", direction: "UNKNOWN", confidence: 0.1, maturity: 0, evidence: { note: "one year of detections; need a second year to read a direction", richness: Object.fromEntries([...byYear].map(([y, s]) => [y, s.size])) } };
  const last = byYear.get(years[years.length - 1])!.size, prev = byYear.get(years[years.length - 2])!.size;
  const rel = (last - prev) / Math.max(1, prev);
  const direction: Direction = rel > 0.1 ? "RISING" : rel < -0.1 ? "FALLING" : "HOLDING";
  return { dimension: "DIVERSITY", direction, confidence: 0.5, maturity: 1, evidence: { richness: Object.fromEntries([...byYear].map(([y, s]) => [y, s.size])), currentYear } };
}

export function renewal(dets: DetPoint[], lat: number): ReadingOut {
  if (dets.length === 0) return { dimension: "RENEWAL", direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "no sound stream yet: breeding-season song is the renewal signal" } };
  const north = lat >= 0;
  const breeding = dets.filter((d) => { const m = d.ts.getUTCMonth() + 1; return north ? m >= 4 && m <= 6 : m >= 10 && m <= 12; });
  const byYear = new Map<number, number>();
  for (const d of breeding) byYear.set(d.ts.getUTCFullYear(), (byYear.get(d.ts.getUTCFullYear()) ?? 0) + 1);
  const years = [...byYear.keys()].sort();
  if (years.length < 2) return { dimension: "RENEWAL", direction: "UNKNOWN", confidence: 0.1, maturity: 0, evidence: { note: "need two breeding seasons", breedingDetections: Object.fromEntries(byYear) } };
  const last = byYear.get(years[years.length - 1])!, prev = byYear.get(years[years.length - 2])!;
  const rel = (last - prev) / Math.max(1, prev);
  return { dimension: "RENEWAL", direction: rel > 0.15 ? "RISING" : rel < -0.15 ? "FALLING" : "HOLDING", confidence: 0.4, maturity: 1, evidence: { breedingDetections: Object.fromEntries(byYear) } };
}

export function structure(idx: IdxPoint[]): ReadingOut {
  const ndsi = idx.filter((i) => i.ndsi !== null);
  if (ndsi.length === 0) return { dimension: "STRUCTURE", direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "no acoustic indices yet (NDSI/ADI); deliver indices or let the server compute them from detections" } };
  const byYear = new Map<number, number[]>();
  for (const i of ndsi) byYear.set(i.ts.getUTCFullYear(), [...(byYear.get(i.ts.getUTCFullYear()) ?? []), i.ndsi!]);
  const years = [...byYear.keys()].sort();
  if (years.length < 2) return { dimension: "STRUCTURE", direction: "UNKNOWN", confidence: 0.1, maturity: 0, evidence: { note: "one year of indices; need a second", ndsiByYear: Object.fromEntries([...byYear].map(([y, v]) => [y, median(v)])) } };
  const last = median(byYear.get(years[years.length - 1])!), prev = median(byYear.get(years[years.length - 2])!);
  const d = last - prev;
  return { dimension: "STRUCTURE", direction: d > 0.05 ? "RISING" : d < -0.05 ? "FALLING" : "HOLDING", confidence: 0.4, maturity: 1, evidence: { ndsiByYear: Object.fromEntries([...byYear].map(([y, v]) => [y, median(v)])) } };
}

export function autonomy(idx: IdxPoint[], dets: DetPoint[]): ReadingOut {
  const anth = idx.filter((i) => i.anthrophony !== null);
  const machine = dets.filter((d) => /engine|vehicle|siren|chainsaw|power tool|tractor/i.test(d.species));
  if (anth.length === 0 && machine.length === 0) return { dimension: "AUTONOMY", direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "no machine-noise signal yet; anthrophony from indices or engine detections from the recorder" } };
  const byYear = new Map<number, number>();
  for (const i of anth) byYear.set(i.ts.getUTCFullYear(), (byYear.get(i.ts.getUTCFullYear()) ?? 0) + (i.anthrophony ?? 0));
  for (const d of machine) byYear.set(d.ts.getUTCFullYear(), (byYear.get(d.ts.getUTCFullYear()) ?? 0) + 1);
  const years = [...byYear.keys()].sort();
  if (years.length < 2) return { dimension: "AUTONOMY", direction: "UNKNOWN", confidence: 0.1, maturity: 0, evidence: { note: "need two years of machine-noise signal", machineByYear: Object.fromEntries(byYear) } };
  const last = byYear.get(years[years.length - 1])!, prev = byYear.get(years[years.length - 2])!;
  const rel = (last - prev) / Math.max(1, prev);
  // less machine noise = more autonomy = rising
  return { dimension: "AUTONOMY", direction: rel < -0.15 ? "RISING" : rel > 0.15 ? "FALLING" : "HOLDING", confidence: 0.3, maturity: 1, evidence: { machineByYear: Object.fromEntries(byYear) } };
}

/**
 * Soil breathing proxy. Heterotrophic respiration scales with temperature (Q10 ~ 2)
 * and is limited by moisture (a simple hump around field capacity). We report a
 * relative activity index per year; direction compares the last two years.
 */
export function cycling(soil: SoilPoint[], optimumVwc = 30): ReadingOut {
  const ok = soil.filter((s) => s.tempC !== null && s.vwc !== null);
  if (ok.length === 0) return { dimension: "CYCLING", direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "no soil stream yet: install a moisture and temperature probe" } };
  const activity = (t: number, vwc: number) => {
    const q10 = Math.pow(2, (t - 10) / 10);
    const m = vwc / 100; // vwc given in percent
    const opt = optimumVwc / 100;
    const moist = Math.max(0, 1 - Math.pow((m - opt) / 0.25, 2)); // hump peaking at the texture-dependent optimum, zero 25 points either side
    return q10 * moist;
  };
  const byYear = new Map<number, number[]>();
  for (const s of ok) byYear.set(s.ts.getUTCFullYear(), [...(byYear.get(s.ts.getUTCFullYear()) ?? []), activity(s.tempC!, s.vwc!)]);
  const idx = Object.fromEntries([...byYear].map(([y, v]) => [y, v.reduce((a, b) => a + b, 0) / v.length]));
  const years = Object.keys(idx).map(Number).sort();
  if (years.length < 2) return { dimension: "CYCLING", direction: "UNKNOWN", confidence: 0.1, maturity: 0, evidence: { note: "one year of soil data; need a second", activityIndexByYear: idx } };
  const rel = (idx[years[years.length - 1]] - idx[years[years.length - 2]]) / Math.max(1e-6, idx[years[years.length - 2]]);
  return { dimension: "CYCLING", direction: rel > 0.1 ? "RISING" : rel < -0.1 ? "FALLING" : "HOLDING", confidence: 0.3, maturity: 1, evidence: { activityIndexByYear: idx, model: `Q10=2 temperature response x moisture hump (peak ${optimumVwc}% VWC, from soil texture)` } };
}

export type Verdict = "thriving" | "holding" | "declining" | "insufficient";

export function verdict(readings: ReadingOut[]): { verdict: Verdict; reason: string } {
  if (readings.some((r) => r.direction === "FALLING" && r.confidence >= 0.3)) {
    const f = readings.filter((r) => r.direction === "FALLING").map((r) => r.dimension.toLowerCase());
    return { verdict: "declining", reason: `falling: ${f.join(", ")}` };
  }
  const unknown = readings.filter((r) => r.direction === "UNKNOWN");
  if (unknown.length > 0) return { verdict: "insufficient", reason: `unknown: ${unknown.map((r) => r.dimension.toLowerCase()).join(", ")}` };
  if (readings.every((r) => r.confidence >= 0.6) && readings.some((r) => r.direction === "RISING")) return { verdict: "thriving", reason: "no dimension falling, confidence high, at least one rising" };
  return { verdict: "holding", reason: "no dimension falling" };
}

export function periodLabel(d = new Date()): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}
