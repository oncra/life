import { prisma } from "@/lib/db";
import { authenticate, json, unauthorized } from "@/lib/auth";
import { SoilBody } from "@/lib/ingest";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const p = await authenticate(req);
  if (!p || p.kind !== "device") return unauthorized();
  if (p.deviceKind !== "SOIL" && p.deviceKind !== "OTHER") return json({ error: "this token belongs to a non-soil device" }, 403);
  const parsed = SoilBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues.slice(0, 10) }, 400);
  const dev = await prisma.device.findUnique({ where: { id: p.id }, select: { depthCm: true } });
  const r = await prisma.soilReading.createMany({ data: parsed.data.readings.map((x) => ({ deviceId: p.id, ts: new Date(x.ts), depthCm: x.depthCm ?? dev?.depthCm ?? 10, vwc: x.vwc, tempC: x.tempC, ec: x.ec, co2Ppm: x.co2Ppm, fluxUmol: x.fluxUmol, raw: x.raw as object | undefined })) });
  return json({ ok: true, readings: r.count }, 201);
}
