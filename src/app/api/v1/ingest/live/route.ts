import { authenticate, json, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { batteryOf } from "@/lib/battery";
import { LiveBody } from "@/lib/ingest";
import { LIVE_EVERY_S, LIVE_KEEP, liveOf, type LiveSample } from "@/lib/node-status";
import { locateCell } from "@/lib/cell-locate";
export const dynamic = "force-dynamic";
/** During a place's demo the node sends its detections this often while live (life-live takes it from the answer). */
const DEMO_PUSH_S = 20;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** How a node on WiFi or a cable is doing now, every LIVE_EVERY_S seconds (node/life-live.py), for the live status panel
 * on its dashboard. The device keeps the latest post and the samples of the last fifteen minutes in one row, overwritten
 * each time; nothing else is stored, the heartbeats stay the record. Any device token; a node on 4G never sends it. */
export async function POST(req: Request) {
  const p = await authenticate(req);
  if (!p || p.kind !== "device") return unauthorized();
  const parsed = LiveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues.slice(0, 10) }, 400);
  const { net, cell, metrics = {} } = parsed.data.live;
  // the oracle's clock, not the node's: live is about now, and a node's clock can be off after a cold start
  const at = Date.now();
  const dev = await prisma.device.findUnique({ where: { id: p.id }, select: { live: true, place: { select: { demoUntil: true } } } });
  const prev = liveOf(dev?.live);
  // only during a demo: where the node is now, from the mast it hears (src/lib/cell-locate.ts); the cell itself is not kept
  const demo = (dev?.place.demoUntil?.getTime() ?? 0) > at;
  const pos = demo ? await locateCell(cell, at) : null;
  const sample: LiveSample = [at, num(metrics.piW), num(metrics.cpuTempC), batteryOf(metrics)?.v ?? num(metrics.vinV), num(cell?.rsrp)];
  const hist = [...(prev?.hist ?? []).filter((s) => at - s[0] <= LIVE_KEEP * LIVE_EVERY_S * 1000), sample].slice(-LIVE_KEEP);
  // the operator and the signal, not the cell id, area or PCI: the panel says how well it hears the network, not where it is
  const c = cell ? { plmn: cell.plmn, rsrp: cell.rsrp, rssi: cell.rssi, sinr: cell.sinr, band: cell.band, mode: cell.mode } : null;
  const live = { at, net: net ?? null, metrics, cell: c, hist, ...(pos ? { pos } : {}) };
  await prisma.device.update({ where: { id: p.id }, data: { live: JSON.parse(JSON.stringify(live)) as object, liveAt: new Date(at) } });
  return json({ ok: true, every: LIVE_EVERY_S, ...(demo ? { push: DEMO_PUSH_S } : {}) }, 201);
}
