import { prisma } from "@/lib/db";
import { json } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { carbonSeries, issuable } from "@/lib/carbon";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const [sat, soil] = await Promise.all([
    prisma.satelliteObs.findMany({ where: { placeId: place.id }, orderBy: { date: "asc" }, select: { date: true, ndviMean: true } }),
    prisma.soilReading.findMany({ where: { device: { placeId: place.id } }, select: { ts: true, depthCm: true, vwc: true, tempC: true } }),
  ]);
  const clay = (place.context as { soil?: { clayPct?: number } } | null)?.soil?.clayPct;
  const series = carbonSeries(sat.map((s) => ({ date: s.date, ndvi: s.ndviMean })), soil, place.landUse, clay);
  return json({
    place: place.slug, areaHa: place.areaHa, landUse: place.landUse, clayPct: clay ?? null,
    method: "necb-v0.1: NPP from NDVI (fAPAR x PAR x LUE, GPP to NPP), Rh from Q10 x moisture (soil probe or climatology), harvest export by land use; every parameter low/high; issue for the lower bound",
    note: "Calibration placeholders for north-west Europe; ranges are wide on purpose until cores and flux data fit them. Not a credit issuance.",
    years: series.map((c) => ({ year: c.year, observations: c.observations, rhSource: c.rhSource, nppTC: c.nppTC, rhTC: c.rhTC, exportTC: c.exportTC, necbTCperHa: c.necbTC, necbCO2perHa: c.necbCO2 })),
    issuable: issuable(series, place.areaHa),
  });
}
