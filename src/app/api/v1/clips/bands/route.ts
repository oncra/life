import { prisma } from "@/lib/db";
import { json } from "@/lib/auth";
import { clipSender } from "@/lib/clips";
export const dynamic = "force-dynamic";

// The node's bands.csv: per month, species and score band, how many detections the sampler saw and how many clips it
// kept from them; a clip's weight is detections / kept. Sent with the clips by clients/clips-upload.py.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { device?: string; rows?: Record<string, string>[] } | null;
  if (!body || !Array.isArray(body.rows)) return json({ error: "send {device?, rows: [...]}" }, 400);
  const who = await clipSender(req, body.device ?? null);
  if (who instanceof Response) return who;
  let n = 0;
  for (const r of body.rows.slice(0, 5000)) {
    const detections = Number(r.detections), kept = Number(r.kept), asOf = new Date(r.as_of_utc);
    if (!r.month || !r.scientific || !r.band || !Number.isFinite(detections) || !Number.isFinite(kept) || Number.isNaN(asOf.getTime())) continue;
    const key = { deviceId: who.deviceId, month: String(r.month).slice(0, 7), scientific: String(r.scientific).slice(0, 120), band: String(r.band).slice(0, 8) };
    await prisma.clipBand.upsert({ where: { deviceId_month_scientific_band: key }, create: { ...key, detections, kept, asOf }, update: { detections, kept, asOf } });
    n++;
  }
  return json({ ok: true, bands: n });
}
