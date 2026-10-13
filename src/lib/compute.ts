import { prisma } from "./db";
import { autonomy, cycling, diversity, periodLabel, productivity, renewal, resilience, structure, verdict, type ReadingOut, type SoilSample } from "./readings";
import { moistureOptimum } from "./context";
import { inCore } from "./listening";
import { soilWaterYears } from "./soilwater";

export async function computeReadings(placeId: string) {
  const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
  const [sat, dets, idx, soil, visits, weather] = await Promise.all([
    prisma.satelliteObs.findMany({ where: { placeId }, orderBy: { date: "asc" } }),
    prisma.soundDetection.findMany({ where: { device: { placeId }, test: false }, select: { ts: true, species: true, scientific: true, confidence: true } }),
    prisma.acousticIndex.findMany({ where: { device: { placeId } }, select: { ts: true, ndsi: true, anthrophony: true, biophony: true, adi: true } }),
    prisma.soilReading.findMany({ where: { device: { placeId } }, select: { ts: true, depthCm: true, vwc: true, tempC: true, fluxUmol: true, deviceId: true } }),
    prisma.visit.findMany({ where: { placeId }, select: { date: true, findings: true } }),
    prisma.weatherDay.findMany({ where: { placeId }, orderBy: { day: "asc" } }),
  ]);
  const soilCtx = (place.context as { soil?: { clayPct?: number; bulkDensity?: number } } | null)?.soil;
  const frame = { bulkDensity: soilCtx?.bulkDensity ?? null, optimumVwc: moistureOptimum(soilCtx?.clayPct) };
  const flux = soil.filter((s) => s.fluxUmol !== null).map((s) => ({ ts: s.ts, fluxUmol: s.fluxUmol!, vwc: s.vwc, tempC: s.tempC }));
  // the water loop: morning water in the top 40 cm, KNMI rain and evaporation, and which probes read in each season
  const obs = soil.filter((s) => s.vwc !== null).map((s) => ({ ts: s.ts.getTime(), depthCm: s.depthCm, vwc: s.vwc! }));
  const wx = weather.map((w) => ({ day: w.day.getTime(), rainHourly: w.rainHourly as (number | null)[], et0: w.et0 }));
  const devicesBySeason: Record<number, string[]> = {};
  for (const s of soil) {
    const m = s.ts.getUTCMonth() + 1, north = place.centroidLat >= 0;
    if (north ? m < 4 || m > 9 : m > 3 && m < 10) continue;
    const y = north ? s.ts.getUTCFullYear() : m >= 7 ? s.ts.getUTCFullYear() + 1 : s.ts.getUTCFullYear();
    if (!(devicesBySeason[y] ??= []).includes(s.deviceId)) devicesBySeason[y].push(s.deviceId);
  }
  const water = { seasons: soilWaterYears(obs, wx, place.centroidLat, place.centroidLon), devicesBySeason, weatherSource: weather.length ? weather[weather.length - 1].source : null, lat: place.centroidLat };
  const pts = sat.map((s) => ({ date: s.date, ndvi: s.ndviMean }));
  // the readings count only the core listening hours (content/spec.md 2.2): extra hours and all-day recorders are kept
  // and shown, never counted, so every place is read on the same hours of the day
  const core = dets.filter((d) => inCore(d.ts.getTime(), place.centroidLat, place.centroidLon));
  const year = new Date().getUTCFullYear();
  const out: ReadingOut[] = [
    productivity(pts, place.centroidLat, year),
    diversity(core, year),
    structure(idx),
    renewal(core, place.centroidLat),
    cycling(soil, frame, visits.flatMap((v) => soilSamples(v.date, v.findings)), flux, water),
    resilience(pts, place.centroidLat),
    autonomy(idx, core),
  ];
  const period = periodLabel();
  for (const r of out) {
    await prisma.reading.upsert({
      where: { placeId_period_dimension: { placeId, period, dimension: r.dimension } },
      create: { placeId, period, dimension: r.dimension, direction: r.direction, confidence: r.confidence, maturity: r.maturity, evidence: r.evidence as object },
      update: { direction: r.direction, confidence: r.confidence, maturity: r.maturity, evidence: r.evidence as object, computedAt: new Date() },
    });
  }
  return { period, readings: out, verdict: verdict(out) };
}

/** Lab results filed with a visit as `findings.soil` (one object or a list): `{depthCm, co2Burst, poxc}`, see content/spec.md 3.5. */
export function soilSamples(date: Date, findings: unknown): SoilSample[] {
  const raw = (findings as { soil?: unknown } | null)?.soil;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return list.map((o) => o as Record<string, unknown>).map((o) => ({ date, depthCm: num(o.depthCm), co2Burst: num(o.co2Burst), poxc: num(o.poxc) }))
    .filter((x) => x.co2Burst !== null || x.poxc !== null);
}
