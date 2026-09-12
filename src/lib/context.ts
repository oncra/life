/**
 * Static context for a place from open global layers, fetched once and refreshed yearly.
 * First source: ISRIC SoilGrids v2.0 (250 m, CC BY 4.0) at the centroid: texture, organic carbon, pH,
 * bulk density, WRB class. Used by the Cycling model (moisture response depends on texture) and as the
 * baseline for the carbon range. More layers (canopy height, potential biomass, expected species) follow.
 */
import { prisma } from "./db";

const SG = "https://rest.isric.org/soilgrids/v2.0";

export interface SoilContext {
  source: "soilgrids-v2.0";
  fetchedAt: string;
  lat: number; lon: number;
  clayPct: number; sandPct: number; siltPct: number;
  socPct: number; ph: number; bulkDensity: number;
  wrbClass: string | null;
  depthsCm: string[];
}

export async function fetchSoilGrids(lat: number, lon: number): Promise<SoilContext> {
  const props = ["clay", "sand", "silt", "soc", "phh2o", "bdod"].map((p) => `property=${p}`).join("&");
  const depths = ["0-5cm", "5-15cm", "15-30cm"];
  const r = await fetch(`${SG}/properties/query?lon=${lon}&lat=${lat}&${props}&${depths.map((d) => `depth=${d}`).join("&")}&value=mean`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`soilgrids ${r.status}`);
  const j = (await r.json()) as { properties: { layers: { name: string; unit_measure: { d_factor: number }; depths: { values: { mean: number | null } }[] }[] } };
  const mean = (name: string) => {
    const l = j.properties.layers.find((x) => x.name === name);
    if (!l) return NaN;
    const vals = l.depths.map((d) => d.values.mean).filter((v): v is number => typeof v === "number");
    if (!vals.length) return NaN;
    return vals.reduce((a, b) => a + b, 0) / vals.length / l.unit_measure.d_factor; // g/kg -> %, dg/kg -> %, pH*10 -> pH, cg/cm3 -> g/cm3
  };
  let wrb: string | null = null;
  try {
    const c = await fetch(`${SG}/classification/query?lon=${lon}&lat=${lat}&number_classes=1`, { signal: AbortSignal.timeout(30_000) });
    if (c.ok) wrb = ((await c.json()) as { wrb_class_name?: string }).wrb_class_name ?? null;
  } catch { /* optional */ }
  return {
    source: "soilgrids-v2.0", fetchedAt: new Date().toISOString(), lat, lon,
    clayPct: Math.round(mean("clay") * 10) / 10, sandPct: Math.round(mean("sand") * 10) / 10, siltPct: Math.round(mean("silt") * 10) / 10,
    socPct: Math.round(mean("soc") * 100) / 100, ph: Math.round(mean("phh2o") * 10) / 10, bulkDensity: Math.round(mean("bdod") * 100) / 100,
    wrbClass: wrb, depthsCm: depths,
  };
}

export async function enrichPlaceContext(placeId: string) {
  const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
  const soil = await fetchSoilGrids(place.centroidLat, place.centroidLon);
  const prev = (place.context as Record<string, unknown> | null) ?? {};
  await prisma.place.update({ where: { id: placeId }, data: { context: { ...prev, soil } as object } });
  return soil;
}

/** Volumetric water content (%) at which soil biological activity peaks, from clay fraction. Rough field-capacity proxy. */
export function moistureOptimum(clayPct: number | undefined): number {
  if (clayPct === undefined || !Number.isFinite(clayPct)) return 30;
  return Math.max(18, Math.min(45, 18 + 0.55 * clayPct)); // sand ~20%, loam ~30%, heavy clay ~40%
}
