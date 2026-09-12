import { prisma } from "./db";

export async function findPlace(idOrSlug: string) {
  return prisma.place.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
}

export async function uniqueSlug(base: string): Promise<string> {
  let slug = base, i = 2;
  while (await prisma.place.findUnique({ where: { slug } })) slug = `${base}-${i++}`;
  return slug;
}

export async function queueJob(kind: string, placeId?: string) {
  const open = await prisma.job.findFirst({ where: { kind, placeId: placeId ?? null, status: { in: ["queued", "running"] } } });
  if (open) return open;
  return prisma.job.create({ data: { kind, placeId } });
}
