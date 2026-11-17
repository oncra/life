import { json } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canSeeNode } from "@/lib/privacy";
import { nodeStatus } from "@/lib/node";
export const dynamic = "force-dynamic";
/** The node's state now, as the status panel on its dashboard shows it (src/lib/node-status.ts): live while the node
 * is on WiFi or a cable, its last readings otherwise. Who may see it is who may see the dashboard (`canSeeNode`); it
 * says nothing about where the node stands. The panel polls it every ten seconds while live, every minute otherwise. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await findPlace(id);
  if (!place || !(await canSeeNode(place, req))) return json({ error: "not found" }, 404);
  const status = await nodeStatus(place);
  if (!status) return json({ error: "no devices on this place" }, 404);
  return json(status, 200, { "cache-control": "no-store" });
}
