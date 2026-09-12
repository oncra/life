import { prisma } from "./db";
import { autonomy, cycling, diversity, periodLabel, productivity, renewal, resilience, structure, verdict, type ReadingOut } from "./readings";
import { moistureOptimum } from "./context";

export async function computeReadings(placeId: string) {
  const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
  const [sat, dets, idx, soil] = await Promise.all([
    prisma.satelliteObs.findMany({ where: { placeId }, orderBy: { date: "asc" } }),
    prisma.soundDetection.findMany({ where: { device: { placeId } }, select: { ts: true, species: true, confidence: true } }),
    prisma.acousticIndex.findMany({ where: { device: { placeId } }, select: { ts: true, ndsi: true, anthrophony: true, biophony: true, adi: true } }),
    prisma.soilReading.findMany({ where: { device: { placeId } }, select: { ts: true, depthCm: true, vwc: true, tempC: true } }),
  ]);
  const pts = sat.map((s) => ({ date: s.date, ndvi: s.ndviMean }));
  const year = new Date().getUTCFullYear();
  const out: ReadingOut[] = [
    productivity(pts, place.centroidLat, year),
    diversity(dets, year),
    structure(idx),
    renewal(dets, place.centroidLat),
    cycling(soil, moistureOptimum(((place.context as { soil?: { clayPct?: number } } | null)?.soil?.clayPct))),
    resilience(pts, place.centroidLat),
    autonomy(idx, dets),
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
