import { json } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canSeeNode } from "@/lib/privacy";
import { asRange, nodeData } from "@/lib/node";
export const dynamic = "force-dynamic";
/** The node dashboard as data. Says nothing about where the node stands. Public unless the place keeps its node to
 * itself (`canSeeNode`): then a viewer who may not see the place exactly gets the 404 a private place gives. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await findPlace(id);
  if (!place || !(await canSeeNode(place, req))) return json({ error: "not found" }, 404);
  const data = await nodeData(place, asRange(new URL(req.url).searchParams.get("range") ?? undefined));
  if (!data) return json({ error: "no devices on this place" }, 404);
  return json({ place: { id: place.id, slug: place.slug, name: place.name }, ...data });
}
