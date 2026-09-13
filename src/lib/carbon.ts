/**
 * Carbon inference, version 0.1. A per-place, per-year net ecosystem carbon balance (NECB) stated as a
 * range, from what the streams already see:
 *
 *   NECB = NPP  -  Rh  -  export  (+ imports)
 *
 *   NPP    net primary productivity from satellite greenness: fAPAR from NDVI, times incoming PAR,
 *          times a light-use efficiency, halved from GPP to NPP (Monteith 1972; Myneni & Williams 1994).
 *   Rh     heterotrophic soil respiration: a reference rate at 10 °C and optimum moisture, scaled by the
 *          Q10 temperature response and the moisture hump, integrated over the year from the soil stream
 *          (or, before a probe exists, from a monthly soil-temperature climatology).
 *   export carbon leaving in harvest, by land use (fraction of NPP), from steward declaration or default.
 *
 * Every parameter carries a low and high value; the range is the min/max over the parameter box. Credits
 * are issued for the lower bound (spec section 5). All numbers below are calibration placeholders for
 * north-west Europe until cores and flux data have been used to fit them; they are kept in one place on
 * purpose so that a method change is one diff.
 */
import type { SatPoint, SoilPoint } from "./readings";
import { moistureOptimum } from "./context";

/** Monthly global radiation, De Bilt long-term mean, MJ/m² per month (KNMI climatology, rounded). */
const GLOBAL_RADIATION_NL = [63, 112, 240, 385, 505, 530, 515, 435, 290, 170, 78, 47];
const PAR_FRACTION = 0.45;

/** Light-use efficiency for GPP, g C per MJ PAR absorbed (low, high). Crops and grass in temperate climate. */
const LUE_GPP = { low: 1.6, high: 2.4 };
const NPP_OVER_GPP = { low: 0.45, high: 0.55 };

/** Heterotrophic respiration reference rate at 10 °C and optimum moisture, t C/ha/yr equivalent (low, high). */
const RH_REF = { low: 3.0, high: 5.0 };
const Q10 = { low: 1.8, high: 2.4 };

/** Carbon exported in harvest as a fraction of NPP, by land use (low, high). */
const EXPORT_FRACTION: Record<string, { low: number; high: number }> = {
  arable: { low: 0.35, high: 0.55 },
  grassland: { low: 0.25, high: 0.45 },
  "peat meadow": { low: 0.25, high: 0.45 },
  orchard: { low: 0.10, high: 0.25 },
  agroforestry: { low: 0.08, high: 0.20 },
  "food forest": { low: 0.05, high: 0.15 },
  forest: { low: 0.0, high: 0.10 },
  wetland: { low: 0.0, high: 0.05 },
  heath: { low: 0.0, high: 0.05 },
  default: { low: 0.15, high: 0.45 },
};

/** Monthly mean soil temperature at 10 cm, De Bilt, °C (approximate climatology). */
const SOIL_TEMP_NL = [3.5, 3.8, 6.0, 9.5, 13.5, 16.5, 18.5, 18.0, 15.0, 11.0, 7.0, 4.5];

const C_TO_CO2 = 44 / 12;

export interface CarbonYear {
  year: number;
  observations: number;
  fapar: number[]; // monthly mean fAPAR (0..1), NaN where no clear scene
  nppTC: { low: number; high: number }; // t C/ha/yr
  rhTC: { low: number; high: number };
  exportTC: { low: number; high: number };
  necbTC: { low: number; high: number };
  necbCO2: { low: number; high: number }; // t CO2/ha/yr
  rhSource: "soil-probe" | "climatology";
}

function fapar(ndvi: number): number {
  return Math.max(0, Math.min(0.95, 1.24 * ndvi - 0.168));
}

function pickExport(landUse: string | null | undefined) {
  const lu = (landUse ?? "").toLowerCase();
  for (const k of Object.keys(EXPORT_FRACTION)) if (k !== "default" && lu.includes(k)) return EXPORT_FRACTION[k];
  return EXPORT_FRACTION.default;
}

/** Monthly mean of a series, with linear fill across gaps of at most three months. */
function monthlyMeans(points: SatPoint[], year: number): number[] {
  const acc: number[][] = Array.from({ length: 12 }, () => []);
  for (const p of points) if (p.date.getUTCFullYear() === year) acc[p.date.getUTCMonth()].push(p.ndvi);
  const m = acc.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN));
  // fill short gaps
  for (let i = 0; i < 12; i++) {
    if (!Number.isNaN(m[i])) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && Number.isNaN(m[a])) a--;
    while (b < 12 && Number.isNaN(m[b])) b++;
    if (a >= 0 && b < 12 && b - a <= 4) m[i] = m[a] + ((m[b] - m[a]) * (i - a)) / (b - a);
    else if (a >= 0 && b >= 12 && i - a <= 2) m[i] = m[a];
    else if (a < 0 && b < 12 && b - i <= 2) m[i] = m[b];
  }
  return m;
}

export function carbonForYear(year: number, sat: SatPoint[], soil: SoilPoint[], landUse: string | null | undefined, clayPct: number | undefined): CarbonYear | null {
  const fp = monthlyMeans(sat, year).map((v) => (Number.isNaN(v) ? NaN : fapar(v)));
  const covered = fp.filter((v) => !Number.isNaN(v)).length;
  if (covered < 8) return null; // not enough of the year seen
  // NPP: sum over months of PAR × fAPAR × LUE, g C/m² → t C/ha (×0.01)
  let apar = 0;
  for (let i = 0; i < 12; i++) if (!Number.isNaN(fp[i])) apar += GLOBAL_RADIATION_NL[i] * PAR_FRACTION * fp[i];
  apar *= 12 / covered; // scale for months not seen
  const npp = { low: (apar * LUE_GPP.low * NPP_OVER_GPP.low) / 100, high: (apar * LUE_GPP.high * NPP_OVER_GPP.high) / 100 };

  // Rh: annual mean of the Q10 × moisture scalar relative to (10 °C, optimum), times the reference rate
  const opt = moistureOptimum(clayPct) / 100;
  const soilYear = soil.filter((s) => s.ts.getUTCFullYear() === year && s.tempC !== null);
  let scalarLow = 0, scalarHigh = 0, rhSource: CarbonYear["rhSource"] = "climatology";
  if (soilYear.length >= 500) {
    rhSource = "soil-probe";
    for (const s of soilYear) {
      const m = s.vwc !== null ? Math.max(0, 1 - Math.pow((s.vwc / 100 - opt) / 0.25, 2)) : 0.8;
      scalarLow += Math.pow(Q10.low, (s.tempC! - 10) / 10) * m;
      scalarHigh += Math.pow(Q10.high, (s.tempC! - 10) / 10) * m;
    }
    scalarLow /= soilYear.length; scalarHigh /= soilYear.length;
  } else {
    for (const t of SOIL_TEMP_NL) { scalarLow += Math.pow(Q10.low, (t - 10) / 10) * 0.8; scalarHigh += Math.pow(Q10.high, (t - 10) / 10) * 0.8; }
    scalarLow /= 12; scalarHigh /= 12;
  }
  const rh = { low: RH_REF.low * Math.min(scalarLow, scalarHigh), high: RH_REF.high * Math.max(scalarLow, scalarHigh) };

  const ef = pickExport(landUse);
  const exp = { low: npp.low * ef.low, high: npp.high * ef.high };
  const necb = { low: npp.low - rh.high - exp.high, high: npp.high - rh.low - exp.low };
  return {
    year, observations: sat.filter((p) => p.date.getUTCFullYear() === year).length, fapar: fp,
    nppTC: npp, rhTC: rh, exportTC: exp, necbTC: necb,
    necbCO2: { low: necb.low * C_TO_CO2, high: necb.high * C_TO_CO2 }, rhSource,
  };
}

export function carbonSeries(sat: SatPoint[], soil: SoilPoint[], landUse: string | null | undefined, clayPct: number | undefined): CarbonYear[] {
  const years = [...new Set(sat.map((p) => p.date.getUTCFullYear()))].sort();
  const thisYear = new Date().getUTCFullYear();
  return years.filter((y) => y < thisYear).map((y) => carbonForYear(y, sat, soil, landUse, clayPct)).filter((c): c is CarbonYear => c !== null);
}

/** Issuable amount: the lower bound of NECB, floored at zero, times area. Negative years issue nothing. */
export function issuable(series: CarbonYear[], areaHa: number) {
  return series.map((c) => ({ year: c.year, lowerBoundTCO2: Math.max(0, c.necbCO2.low) * areaHa, upperBoundTCO2: Math.max(0, c.necbCO2.high) * areaHa }));
}
