import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { buildImage, checkWifi, createBox } from "@/lib/boximage";
import { boxOut } from "@/lib/boxout";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  ssid: z.string().max(64).optional().default(""),
  psk: z.string().max(64).optional().default(""),
});

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  const boxes = await prisma.box.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { place: { select: { slug: true } } } });
  return json({ email: user.email, items: boxes.map(boxOut) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Give the box a name." }, 400);
  const wifiError = checkWifi(p.data.ssid, p.data.psk);
  if (wifiError) return json({ error: wifiError }, 400);
  if ((await prisma.box.count({ where: { userId: user.id } })) >= 10) return json({ error: "You have ten boxes already. Write to us if you need more." }, 400);
  const box = await createBox(user.id, p.data.name);
  void buildImage(box.id, { ssid: p.data.ssid.trim() ? p.data.ssid : undefined, psk: p.data.psk || undefined });
  return json({ id: box.id }, 201);
}
