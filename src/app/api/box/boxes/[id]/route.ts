import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { boxOut } from "@/lib/boxout";
import { goldenVersion } from "@/lib/boximage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const box = await prisma.box.findFirst({ where: { id, userId: user.id }, include: { place: { select: { slug: true } } } });
  if (!box) return json({ error: "not found" }, 404);
  return json(boxOut(box, await goldenVersion()));
}
