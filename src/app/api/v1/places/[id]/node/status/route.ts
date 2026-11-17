import { json } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { nodeStatus, sunPlace } from "@/lib/node";
import { canSeeExact } from "@/lib/privacy";
export const dynamic = "force-dynamic";
/** The node's state now, as the status panel on its dashboard shows it (src/lib/node-status.ts): live while the node
 * is on WiFi or a cable, its last readings otherwise. Public for every place, like the dashboard; it says nothing about
 * where the node stands, and its windows are reckoned for the point the viewer sees (`sunPlace`). The panel polls it
 * every ten seconds while live, every minute otherwise. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const status = await nodeStatus(sunPlace(place, await canSeeExact(place, req)));
  if (!status) return json({ error: "no devices on this place" }, 404);
  return json(status, 200, { "cache-control": "no-store" });
}
