import { z } from "zod";

export const Detection = z.object({
  ts: z.string().datetime({ offset: true }),
  species: z.string().min(1).max(120),
  scientific: z.string().max(120).optional(),
  confidence: z.number().min(0).max(1),
  detector: z.string().max(80).default("unknown"),
  durationS: z.number().min(0).max(3600).optional(),
});

export const Index = z.object({
  ts: z.string().datetime({ offset: true }),
  windowS: z.number().int().min(1).max(86400).default(60),
  aci: z.number().optional(),
  adi: z.number().optional(),
  aei: z.number().optional(),
  bio: z.number().optional(),
  ndsi: z.number().min(-1).max(1).optional(),
  biophony: z.number().optional(),
  anthrophony: z.number().optional(),
  spl: z.number().optional(),
});

export const CellIn = z.object({
  plmn: z.string().max(8).optional(),
  cellId: z.union([z.string().max(32), z.number().int().nonnegative()]).optional(),
  tac: z.union([z.string().max(16), z.number().int().nonnegative()]).optional(),
  pci: z.number().int().optional(),
  band: z.string().max(16).optional(),
  rsrp: z.number().optional(),
  rssi: z.number().optional(),
  sinr: z.number().optional(),
  mode: z.string().max(16).optional(),
});

/** A node's liveness message: when, why, on which cell, and how it is doing. All optional but the shape. */
export const HeartbeatIn = z.object({
  ts: z.string().datetime({ offset: true }).optional(),
  event: z.enum(["boot", "hourly", "shutdown", "manual"]).optional(),
  cell: CellIn.optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).optional(),
});

export const SoundBody = z.object({ detections: z.array(Detection).max(5000).default([]), indices: z.array(Index).max(5000).default([]), heartbeat: HeartbeatIn.optional() });
export const HeartbeatBody = z.object({ heartbeat: HeartbeatIn });

export const SoilRow = z.object({
  ts: z.string().datetime({ offset: true }),
  depthCm: z.number().int().min(0).max(300).optional(),
  vwc: z.number().min(0).max(100).optional(),
  tempC: z.number().min(-50).max(80).optional(),
  ec: z.number().min(0).optional(),
  co2Ppm: z.number().min(0).optional(),
  fluxUmol: z.number().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export const SoilBody = z.object({ readings: z.array(SoilRow).max(5000) });

/**
 * Map a decoded LoRaWAN payload (The Things Stack `decoded_payload`) to our soil row.
 * Known decoders: Dragino LSE01/SE01-LB (temp_SOIL, water_SOIL, conduct_SOIL), Milesight EM500-SMTC
 * (temperature, humidity, conductivity), Seeed SenseCAP S2104/S2105 (measurementValue per measurementId),
 * Decentlab DL-TRS12 (volumetric_water_content, soil_temperature, electrical_conductivity). A per-device
 * `mapping` {vwc: "field", tempC: "field", ec: "field"} overrides the heuristics.
 */
export function mapDecodedPayload(p: Record<string, unknown>, mapping?: Record<string, string> | null): { vwc?: number; tempC?: number; ec?: number; co2Ppm?: number } {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const pick = (...keys: string[]) => { for (const k of keys) { const v = num(p[k]); if (v !== undefined) return v; } return undefined; };
  if (mapping) {
    return { vwc: mapping.vwc ? num(p[mapping.vwc]) : undefined, tempC: mapping.tempC ? num(p[mapping.tempC]) : undefined, ec: mapping.ec ? num(p[mapping.ec]) : undefined, co2Ppm: mapping.co2Ppm ? num(p[mapping.co2Ppm]) : undefined };
  }
  let vwc = pick("water_SOIL", "vwc", "volumetric_water_content", "soil_moisture", "moisture", "humidity", "SoilMoisture", "soil_humidity");
  const tempC = pick("temp_SOIL", "tempC", "soil_temperature", "temperature", "SoilTemperature", "temp");
  let ec = pick("conduct_SOIL", "ec", "electrical_conductivity", "conductivity", "EC", "soil_ec");
  // Seeed SenseCAP: {messages:[{measurementId:4102, measurementValue:..}]} ids 4102 temp, 4103 vwc, 4108 ec
  const msgs = (p.messages as { measurementId?: number | string; measurementValue?: unknown }[] | undefined);
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      const id = Number(m.measurementId), v = num(m.measurementValue);
      if (v === undefined) continue;
      if (id === 4103 && vwc === undefined) vwc = v;
      if (id === 4108 && ec === undefined) ec = v;
    }
  }
  // Decentlab reports VWC as fraction 0..1
  if (vwc !== undefined && vwc <= 1 && (p.volumetric_water_content !== undefined)) vwc = vwc * 100;
  // Dragino/Milesight report EC in µS/cm; keep µS/cm as the unit of record
  return { vwc, tempC, ec, co2Ppm: pick("co2", "co2Ppm", "CO2") };
}
