import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { buildImage, checkWifi } from "@/lib/boximage";

export const dynamic = "force-dynamic";

// A new image for an existing box, e.g. another WiFi. New device tokens are minted, so an older image stops posting.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const box = await prisma.box.findFirst({ where: { id, userId: user.id } });
  if (!box) return json({ error: "not found" }, 404);
  if (box.imageStatus === "BUILDING" && box.createdAt > new Date(Date.now() - 5 * 60e3)) return json({ error: "This box's image is still being made." }, 409);
  const p = z.object({ ssid: z.string().max(64).default(""), psk: z.string().max(64).default("") }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "invalid body" }, 400);
  const wifiError = checkWifi(p.data.ssid, p.data.psk);
  if (wifiError) return json({ error: wifiError }, 400);
  await prisma.box.update({ where: { id }, data: { imageStatus: "BUILDING", imageError: null } });
  void buildImage(id, { ssid: p.data.ssid.trim() ? p.data.ssid : undefined, psk: p.data.psk || undefined });
  return json({ ok: true }, 202);
}
