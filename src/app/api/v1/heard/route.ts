import { json } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findPlace } from "@/lib/places";
import { heard, nodeStates } from "@/lib/node";
export const dynamic = "force-dynamic";

const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://life.oncra.org").replace(/\/$/, "");
// Open data: any site may show what the nodes hear (climatecleanup.org does, on its home page).
const HEADERS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" };
const num = (s: string | null) => (s !== null && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

/** The species the nodes heard last, one per species whatever name it came under, newest first, each with its cut-out
 * picture, its credits and its common names in other languages, plus whether each node is listening now. Public like
 * the node dashboard, for every place: it says what was heard and when, never where. `?place=` narrows it to one
 * place (slug or id); `?min=` is the lowest confidence, 0.7 by default, the threshold the diversity reading counts
 * from; `?images=only` leaves out species whose picture the worker has not made yet. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(20, Math.round(num(q.get("limit")) ?? 6)));
  const min = Math.max(0, Math.min(1, num(q.get("min")) ?? 0.7));
  let placeId: string | undefined;
  const placeParam = q.get("place");
  if (placeParam) {
    const p = await findPlace(placeParam);
    if (!p) return json({ error: "not found" }, 404, HEADERS);
    placeId = p.id;
  }
  const now = Date.now();
  const [items, nodes] = await Promise.all([heard({ placeId, limit, minConfidence: min, withImage: q.get("images") === "only" }), nodeStates(now, placeId)]);
  const slugs = new Map(nodes.map((n) => [n.placeId, n.slug]));
  const missing = [...new Set(items.map((i) => i.placeId).filter((id) => !slugs.has(id)))];
  if (missing.length) for (const p of await prisma.place.findMany({ where: { id: { in: missing } }, select: { id: true, slug: true } })) slugs.set(p.id, p.slug);
  const node = (placeId: string) => ({ slug: slugs.get(placeId) ?? null, href: slugs.has(placeId) ? `${site}/places/${slugs.get(placeId)}/node` : null });
  return json({
    now, min,
    items: items.map((i) => ({
      key: i.key, species: i.species, scientific: i.scientific, names: i.names, t: new Date(i.t).toISOString(), confidence: i.confidence,
      image: i.image ? { url: `${site}/api/species-image/${i.image.id}.webp`, width: i.image.width, height: i.image.height, author: i.image.author, license: i.image.license, licenseUrl: i.image.licenseUrl, sourceUrl: i.image.sourceUrl } : null,
      node: node(i.placeId),
    })),
    nodes: nodes.map((n) => ({ ...node(n.placeId), status: n.status, heardAt: n.heardAt ? new Date(n.heardAt).toISOString() : null })),
  }, 200, HEADERS);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-methods": "GET, OPTIONS", "access-control-max-age": "86400" } });
}
