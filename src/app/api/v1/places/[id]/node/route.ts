import { json } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { asRange, nodeData } from "@/lib/node";
export const dynamic = "force-dynamic";
/** The node dashboard as data, public for every place. Says nothing about where the node stands. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const data = await nodeData(place, asRange(new URL(req.url).searchParams.get("range") ?? undefined));
  if (!data) return json({ error: "no devices on this place" }, 404);
  return json({ place: { id: place.id, slug: place.slug, name: place.name }, ...data });
}
