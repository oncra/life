import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { placeBox } from "@/lib/boximage";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const box = await prisma.box.findFirst({ where: { id, userId: user.id } });
  if (!box) return json({ error: "not found" }, 404);
  const p = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "That is not a location." }, 400);
  await placeBox(id, p.data.lat, p.data.lon);
  return json({ ok: true });
}
