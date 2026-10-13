/**
 * The soil's water loop, read from the node's own probes and open weather data (content/spec.md 3.5, method
 * cycling-v0.3; the evidence for every choice below is content/soil-water.md).
 *
 *   uptake  how much water leaves the top 40 cm on a dry day, as a share of the day's reference evaporation
 *           (Makkink). On a dry day, two days or more after rain, the loss from the root zone is mostly roots drawing
 *           water for transpiration (the soil water balance method; compared with step-shaped and model methods by
 *           Guderle and Hildebrandt 2015, doi 10.5194/hess-19-409-2015). More living roots and cover in the top
 *           40 cm: a larger share. It is also the speed at which the soil dries out, freed of the weather's demand.
 *           On the Twente network it is 0.60 under permanent grass and 0.38 under maize.
 *
 * A second number, the share of a rain shower still held in the top 40 cm the next morning, was tested on the same
 * network and left out: it did not tell grass from maize and swung far more from year to year.
 *
 * Every comparison runs from one morning to the next, at the same hour and so at nearly the same soil temperature: a
 * capacitance probe reads a little differently when the soil is warm. The node reads its probes every 20 minutes
 * while it is awake, and it is always awake in the first hour of its core listening window (listening.ts): civil
 * dawn from March to October, sunrise from November to February.
 */
import { coreWindows } from "./listening";

const H = 36e5;
const DAY = 864e5;

export interface SoilObs { ts: number; depthCm: number; vwc: number } // vwc in percent
/** One UTC day of weather at the place: rain per UTC hour (index 0 is 00:00 to 01:00), reference evaporation (mm). */
export interface WeatherDayIn { day: number; rainHourly: (number | null)[]; et0: number | null }
export interface SoilWaterYear { year: number; uptake: number | null; uptakeDays: number }

/** Rules of the method; every number here is in content/spec.md 3.5 and was set on the Twente network (scripts/soil-noise). */
export const SOIL_WATER = {
  /** a morning is the first hour of the day's first core window */
  morningH: 1,
  /** probes at 15 cm or less are the upper layer (0-20 cm), 15 to 45 cm the lower (20-40 cm) */
  shallowMaxCm: 15, deepMaxCm: 45,
  /** uptake: no more rain than this (mm) from 48 h before the first morning to the second */
  uptakeDryMm: 0.3, uptakeMinEt0: 1.0, uptakeMinDays: 10,
  /** Cycling thresholds: the 90th percentile of the change at Twente stations where nothing changed (soil-water.md) */
  thresholdOneYear: 0.41, thresholdTwoYears: 0.29,
};

/** Season months (north): April to September. South of the equator six months on. */
function seasonOf(day: number, lat: number): { year: number; month: number } {
  const d = new Date(day);
  const m = d.getUTCMonth() + 1;
  if (lat >= 0) return { year: d.getUTCFullYear(), month: m };
  return { year: m >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(), month: ((m + 5) % 12) + 1 };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
export const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Water in the top 40 cm (mm) each morning: 200 mm of soil per probe layer, keyed by UTC day. */
export function morningStorage(obs: SoilObs[], lat: number, lon: number): Map<number, { t: number; s: number }> {
  const byDay = new Map<number, { t: number; up: number[]; low: number[] }>();
  const windows = new Map<number, [number, number]>();
  for (const o of obs) {
    if (!Number.isFinite(o.vwc) || o.vwc <= 0 || o.vwc > 70) continue;
    const day = Math.floor(o.ts / DAY) * DAY;
    let w = windows.get(day);
    if (!w) {
      const first = coreWindows(day, lat, lon)[0];
      w = [first[0], first[0] + SOIL_WATER.morningH * H];
      windows.set(day, w);
    }
    if (o.ts < w[0] || o.ts >= w[1]) continue;
    const cur = byDay.get(day) ?? { t: (w[0] + w[1]) / 2, up: [], low: [] };
    if (o.depthCm <= SOIL_WATER.shallowMaxCm) cur.up.push(o.vwc);
    else if (o.depthCm <= SOIL_WATER.deepMaxCm) cur.low.push(o.vwc);
    byDay.set(day, cur);
  }
  // one layout for the whole series: both layers if the lower one is ever there, else the upper one for 40 cm
  const hasLow = [...byDay.values()].some((d) => d.low.length > 0);
  const out = new Map<number, { t: number; s: number }>();
  for (const [day, d] of byDay) {
    if (!d.up.length || (hasLow && !d.low.length)) continue;
    const s = hasLow ? 2 * mean(d.up) + 2 * mean(d.low) : 4 * mean(d.up);
    out.set(day, { t: d.t, s });
  }
  return out;
}

/** Rain (mm) in [from, to) from hourly totals; null when an hour in the span has no value. */
function rainBetween(hours: Map<number, number | null>, from: number, to: number): number | null {
  let sum = 0;
  for (let h = Math.floor(from / H) * H; h < to; h += H) {
    const v = hours.get(h);
    if (v === undefined || v === null) return null;
    const lo = Math.max(h, from), hi = Math.min(h + H, to);
    sum += v * ((hi - lo) / H);
  }
  return sum;
}

/** Per season year: the median uptake share on dry days, with the number of days behind it. */
export function soilWaterYears(obs: SoilObs[], weather: WeatherDayIn[], lat: number, lon: number): SoilWaterYear[] {
  const S = morningStorage(obs, lat, lon);
  const hours = new Map<number, number | null>();
  const et0 = new Map<number, number | null>();
  for (const w of weather) {
    et0.set(w.day, w.et0);
    w.rainHourly.forEach((v, i) => hours.set(w.day + i * H, v));
  }
  const up = new Map<number, number[]>();
  for (const [day, a] of S) {
    const b = S.get(day + DAY);
    if (!b) continue;
    const { year, month } = seasonOf(day, lat);
    if (month < 4 || month > 9) continue;
    const e = et0.get(day);
    if (e === null || e === undefined || e < SOIL_WATER.uptakeMinEt0) continue;
    const rain = rainBetween(hours, a.t - 48 * H, b.t);
    if (rain === null || rain > SOIL_WATER.uptakeDryMm) continue;
    up.set(year, [...(up.get(year) ?? []), (a.s - b.s) / e]);
  }
  return [...up.keys()].sort().map((year) => {
    const u = up.get(year)!;
    return { year, uptake: u.length >= SOIL_WATER.uptakeMinDays ? Math.round(median(u) * 1000) / 1000 : null, uptakeDays: u.length };
  });
}
