import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
/** The stored cut-out of a species (WebP with alpha), made once by the worker; see src/lib/species-image.ts. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.speciesImage.findUnique({ where: { id: id.replace(/\.webp$/, "") }, select: { image: true, status: true, species: true } });
  if (!row?.image || row.status !== "ready") return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(row.image), { headers: { "content-type": "image/webp", "cache-control": "public, max-age=604800", "content-disposition": `inline; filename="${row.species.replace(/[^\w.-]+/g, "-")}.webp"` } });
}
