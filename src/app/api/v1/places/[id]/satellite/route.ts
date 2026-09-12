import { prisma } from "@/lib/db";
import { json } from "@/lib/auth";
import { findPlace } from "@/lib/places";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  const rows = await prisma.satelliteObs.findMany({ where: { placeId: place.id }, orderBy: { date: "asc" } });
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const csv = ["date,scene,ndvi_mean,ndvi_p10,ndvi_p90,valid_fraction,cloud_cover,pixels", ...rows.map((r) => [r.date.toISOString().slice(0, 10), r.sceneId, r.ndviMean.toFixed(4), r.ndviP10?.toFixed(4) ?? "", r.ndviP90?.toFixed(4) ?? "", r.validFraction.toFixed(3), r.cloudCover ?? "", r.pixelCount].join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=${place.slug}-ndvi.csv` } });
  }
  return json({ place: place.slug, source: "sentinel-2-l2a via Earth Search (Element 84), SCL cloud mask", count: rows.length, items: rows });
}
