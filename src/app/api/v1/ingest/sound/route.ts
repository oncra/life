import { prisma } from "@/lib/db";
import { authenticate, json, unauthorized } from "@/lib/auth";
import { HeartbeatIn, SoundBody } from "@/lib/ingest";
import { recordHeartbeat } from "@/lib/alerts";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const p = await authenticate(req);
  if (!p || p.kind !== "device") return unauthorized();
  if (p.deviceKind !== "SOUND" && p.deviceKind !== "OTHER") return json({ error: "this token belongs to a non-sound device" }, 403);
  const parsed = SoundBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues.slice(0, 10) }, 400);
  const { detections, indices, heartbeat } = parsed.data;
  const beat = heartbeat === undefined || heartbeat === null ? null : HeartbeatIn.safeParse(heartbeat);
  const [d, i] = await Promise.all([
    detections.length ? prisma.soundDetection.createMany({ data: detections.map((x) => ({ deviceId: p.id, ts: new Date(x.ts), species: x.species, scientific: x.scientific, confidence: x.confidence, detector: x.detector, durationS: x.durationS, test: x.test ?? false })) }) : { count: 0 },
    indices.length ? prisma.acousticIndex.createMany({ data: indices.map((x) => ({ deviceId: p.id, ts: new Date(x.ts), windowS: x.windowS, aci: x.aci, adi: x.adi, aei: x.aei, bio: x.bio, ndsi: x.ndsi, biophony: x.biophony, anthrophony: x.anthrophony, spl: x.spl })) }) : { count: 0 },
  ]);
  // a node rides its heartbeat on the hourly push, so the SIM pays for one TLS handshake, not two
  const hb = beat?.success ? await recordHeartbeat(p.id, beat.data) : undefined;
  return json({ ok: true, detections: d.count, indices: i.count, heartbeat: hb, ...(beat && !beat.success ? { heartbeatError: beat.error.issues.slice(0, 10) } : {}) }, 201);
}
