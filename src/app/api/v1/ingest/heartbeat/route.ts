import { authenticate, json, unauthorized } from "@/lib/auth";
import { HeartbeatBody } from "@/lib/ingest";
import { recordHeartbeat } from "@/lib/alerts";
export const dynamic = "force-dynamic";
/** Liveness on its own, for a node that has nothing else to post. Any device token. */
export async function POST(req: Request) {
  const p = await authenticate(req);
  if (!p || p.kind !== "device") return unauthorized();
  const parsed = HeartbeatBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues.slice(0, 10) }, 400);
  const out = await recordHeartbeat(p.id, parsed.data.heartbeat);
  return json({ ok: true, ...out }, 201);
}
