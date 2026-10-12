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
export interface DetPoint { ts: Date; species: string; scientific?: string | null; confidence: number }
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
  return { dimension: "PRODUCTIVITY", direction, confidence, maturity, evidence: { lastSeason: last, referenceMedian: ref, delta, seasons: complete, note: "single-place reading: the last growing season against the place's own previous three; regional weather (a dry spring, a wet summer) is not yet subtracted because the neighbour crowd is not built" } };
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
  // a species is its scientific name: the same bird can arrive under its common and its scientific name
  for (const d of dets) if (d.confidence >= 0.7) byYear.set(d.ts.getUTCFullYear(), (byYear.get(d.ts.getUTCFullYear()) ?? new Set()).add(d.scientific ?? d.species));
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

export interface FluxPoint { ts: Date; fluxUmol: number; vwc: number | null; tempC: number | null }
/** A soil sample from a visit, analysed in a lab under standard conditions (dried, rewetted, 24 h at a fixed temperature). */
export interface SoilSample { date: Date; depthCm: number | null; co2Burst: number | null; poxc: number | null }
/** What the Cycling model needs to know about the soil: from SoilGrids, else a clay-only fallback. */
export interface SoilFrame { bulkDensity?: number | null; optimumVwc: number }

/**
 * Weather-expected soil activity (dimensionless, 1 at 10 °C and optimal moisture). It says how hard soil life
 * could work in this weather; it does not say how much soil life there is.
 * Temperature: Q10 = 2 at 10 °C (van 't Hoff; field Q10 of soil respiration has a median near 2.4, Raich and
 * Schlesinger 1992; it falls with warming, Lloyd and Taylor 1994, so 2 is a central value, not a constant of nature).
 * Moisture: aerobic activity peaks near 60% water-filled pore space and falls on both sides, water-limited below
 * and oxygen-limited above (Linn and Doran 1984; Skopp et al. 1990). WFPS = VWC / porosity, porosity = 1 - BD / 2.65.
 * The hump is zero at WFPS 0 and leaves about half the activity at saturation. Without bulk density the older hump in
 * VWC around a clay-based optimum is used. Empirical moisture curves are approximations (Moyano et al. 2013).
 */
export function soilActivity(tempC: number, vwc: number, frame: SoilFrame): number {
  const q10 = Math.pow(2, (tempC - 10) / 10);
  const bd = frame.bulkDensity;
  if (bd && bd > 0.2 && bd < 2.2) {
    const wfps = vwc / 100 / (1 - bd / 2.65);
    return q10 * Math.max(0, 1 - Math.pow((wfps - 0.6) / 0.6, 2));
  }
  return q10 * Math.max(0, 1 - Math.pow((vwc / 100 - frame.optimumVwc / 100) / 0.25, 2));
}

const DAY = 864e5;
const doy = (d: Date) => Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY);
const relChange = (a: number, b: number) => (b - a) / Math.max(1e-6, Math.abs(a));

/**
 * Cycling: is the soil's own life changing, with the weather taken out?
 * Moisture and temperature alone cannot answer that: a warm, moist year raises the expected activity without any
 * change in the soil. So the direction comes only from a measured soil-life signal, in this order of weight:
 *   1. lab samples from visits, same depth and season each year: 24 h CO2 burst after rewetting (Franzluebbers et al.
 *      2000; Haney et al. 2008) and permanganate-oxidisable carbon, POXC (Weil et al. 2003). Both are run under
 *      standard lab conditions, so the weather of the day does not enter, and both respond to management within a few
 *      years (Hurisso et al. 2016).
 *   2. measured CO2 flux from the soil (chamber or gradient method), divided by the weather-expected activity at the
 *      same moments: the basal rate at 10 °C and optimal moisture, which is the part that belongs to the soil.
 * Without either, the reading is UNKNOWN; the weather-expected activity stays in the evidence as context.
 */
export function cycling(soil: SoilPoint[], frame: SoilFrame, samples: SoilSample[] = [], flux: FluxPoint[] = []): ReadingOut {
  const method = "cycling-v0.2";
  const ok = soil.filter((s) => s.tempC !== null && s.vwc !== null);
  const condByYear = new Map<number, number[]>();
  for (const s of ok) condByYear.set(s.ts.getUTCFullYear(), [...(condByYear.get(s.ts.getUTCFullYear()) ?? []), soilActivity(s.tempC!, s.vwc!, frame)]);
  const conditionsIndexByYear = Object.fromEntries([...condByYear].map(([y, v]) => [y, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000]));
  const context = { method, conditionsIndexByYear, conditionsNote: "weather-expected activity from moisture and temperature; context, not a direction" };

  // 1. lab samples: the latest against the most recent earlier one taken in the same season (within 45 days of the
  // same day of the year, at least 300 days before), at the same depth when both give one
  const labs = samples.filter((s) => s.co2Burst !== null || s.poxc !== null).sort((a, b) => a.date.getTime() - b.date.getTime());
  const changes: Record<string, number> = {};
  let pair: [SoilSample, SoilSample] | null = null;
  if (labs.length >= 2) {
    const last = labs[labs.length - 1];
    for (let i = labs.length - 2; i >= 0; i--) {
      const prev = labs[i];
      const gap = last.date.getTime() - prev.date.getTime();
      const dd = Math.abs(doy(last.date) - doy(prev.date));
      const sameSeason = Math.min(dd, 365 - dd) <= 45;
      const sameDepth = last.depthCm === null || prev.depthCm === null || last.depthCm === prev.depthCm;
      if (gap >= 300 * DAY && sameSeason && sameDepth) { pair = [prev, last]; break; }
    }
    if (pair) {
      const [a, b] = pair;
      if (a.co2Burst !== null && b.co2Burst !== null && a.co2Burst > 0) changes.co2Burst = relChange(a.co2Burst, b.co2Burst);
      if (a.poxc !== null && b.poxc !== null && a.poxc > 0) changes.poxc = relChange(a.poxc, b.poxc);
    }
  }
  const lab = Object.values(changes);
  if (lab.length) {
    const rel = lab.reduce((x, y) => x + y, 0) / lab.length;
    const agree = lab.length === 2 && Math.sign(lab[0]) === Math.sign(lab[1]);
    return {
      dimension: "CYCLING", direction: rel > 0.15 ? "RISING" : rel < -0.15 ? "FALLING" : "HOLDING", confidence: agree ? 0.5 : 0.35, maturity: 1,
      evidence: { ...context, source: "lab samples", from: pair![0].date.toISOString().slice(0, 10), to: pair![1].date.toISOString().slice(0, 10), relativeChange: changes, threshold: 0.15 },
    };
  }

  // 2. measured flux, normalised to 10 °C and optimal moisture
  const fx = flux.filter((f) => f.tempC !== null && f.vwc !== null && Number.isFinite(f.fluxUmol));
  const refByYear = new Map<number, { f: number; a: number; n: number }>();
  for (const f of fx) {
    const a = soilActivity(f.tempC!, f.vwc!, frame);
    if (a < 0.05) continue; // frozen or bone-dry: the ratio is noise
    const y = f.ts.getUTCFullYear();
    const cur = refByYear.get(y) ?? { f: 0, a: 0, n: 0 };
    refByYear.set(y, { f: cur.f + f.fluxUmol, a: cur.a + a, n: cur.n + 1 });
  }
  const basal = Object.fromEntries([...refByYear].filter(([, v]) => v.n >= 30).map(([y, v]) => [y, Math.round((v.f / v.a) * 1000) / 1000]));
  const fy = Object.keys(basal).map(Number).sort();
  if (fy.length >= 2) {
    const rel = relChange(basal[fy[fy.length - 2]], basal[fy[fy.length - 1]]);
    return {
      dimension: "CYCLING", direction: rel > 0.1 ? "RISING" : rel < -0.1 ? "FALLING" : "HOLDING", confidence: 0.45, maturity: 1,
      evidence: { ...context, source: "soil CO2 flux", basalRateByYear: basal, unit: "µmol CO2 m-2 s-1 at 10 °C and optimal moisture", threshold: 0.1 },
    };
  }

  const note = labs.length || fy.length
    ? "one measurement period so far; the direction needs a second in the same season"
    : ok.length
      ? "moisture and temperature show the weather, not the soil's life; a yearly lab sample (24 h CO2 burst and POXC, same month and depth) or a CO2 flux probe gives the direction"
      : "no soil stream yet: install a moisture and temperature probe and take a yearly lab sample";
  return { dimension: "CYCLING", direction: "UNKNOWN", confidence: ok.length ? 0.1 : 0, maturity: 0, evidence: { ...context, note, basalRateByYear: Object.keys(basal).length ? basal : undefined } };
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
