import { prisma } from "@/lib/db";
import { authenticate, json, unauthorized } from "@/lib/auth";
import { mapDecodedPayload } from "@/lib/ingest";
export const dynamic = "force-dynamic";

/**
 * The Things Stack webhook receiver. Configure a webhook in your TTN application with
 *   base URL  https://life.oncra.org/api/v1/ingest/ttn
 *   header    Authorization: Bearer <device token>   (one webhook per device)
 * or, for one webhook per application, use a STEWARD/ADMIN key and register each device's DevEUI
 * on the place; the device is then matched by `end_device_ids.dev_eui`.
 */
interface TtnUplink {
  end_device_ids?: { device_id?: string; dev_eui?: string };
  received_at?: string;
  uplink_message?: { decoded_payload?: Record<string, unknown>; received_at?: string; f_port?: number; frm_payload?: string; rx_metadata?: unknown[] };
}

export async function POST(req: Request) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  const body = (await req.json().catch(() => null)) as TtnUplink | null;
  if (!body?.uplink_message) return json({ ok: true, ignored: "not an uplink" });
  let deviceId: string | null = null, mapping: Record<string, string> | null = null, fallbackDepth = 10;
  if (p.kind === "device") { deviceId = p.id; mapping = (p.mapping as Record<string, string> | null) ?? null; }
  else {
    const eui = body.end_device_ids?.dev_eui?.toUpperCase();
    if (!eui) return json({ error: "no dev_eui in uplink and token is not a device token" }, 400);
    const d = await prisma.device.findUnique({ where: { devEui: eui } });
    if (!d) return json({ error: `no device registered with DevEUI ${eui}` }, 404);
    if (p.kind === "key" && p.role === "STEWARD" && p.placeId && p.placeId !== d.placeId) return json({ error: "key not valid for this device's place" }, 403);
    deviceId = d.id; mapping = (d.mapping as Record<string, string> | null) ?? null; fallbackDepth = d.depthCm ?? 10;
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
  }
  const decoded = body.uplink_message.decoded_payload ?? {};
  const m = mapDecodedPayload(decoded, mapping);
  if (m.vwc === undefined && m.tempC === undefined && m.ec === undefined && m.co2Ppm === undefined) {
    return json({ ok: false, error: "no soil fields recognised in decoded_payload; set a `mapping` on the device", decodedKeys: Object.keys(decoded) }, 422);
  }
  const ts = new Date(body.uplink_message.received_at ?? body.received_at ?? Date.now());
  const row = await prisma.soilReading.create({ data: { deviceId: deviceId!, ts, depthCm: fallbackDepth, vwc: m.vwc, tempC: m.tempC, ec: m.ec, co2Ppm: m.co2Ppm, raw: decoded as object } });
  return json({ ok: true, id: row.id, stored: m }, 201);
}
