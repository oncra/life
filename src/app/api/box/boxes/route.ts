import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { buildImage, checkWifi, createBox, goldenVersion } from "@/lib/boximage";
import { boxLive, boxOut } from "@/lib/boxout";
import { ownPlaces } from "@/lib/places";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  ssid: z.string().max(64).optional().default(""),
  psk: z.string().max(64).optional().default(""),
  /** set the box up for one of the person's own places instead of a new one */
  placeId: z.string().max(40).optional(),
});

export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();
  const boxes = await prisma.box.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { place: { select: { slug: true, name: true } } } });
  const golden = await goldenVersion();
  return json({ email: user.email, places: await ownPlaces(user.id), items: await Promise.all(boxes.map(async (b) => ({ ...boxOut(b, golden), live: await boxLive(b.placeId, b.hostname) }))) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Give the box a name." }, 400);
  const wifiError = checkWifi(p.data.ssid, p.data.psk);
  if (wifiError) return json({ error: wifiError }, 400);
  if ((await prisma.box.count({ where: { userId: user.id } })) >= 10) return json({ error: "You have ten boxes already. Write to us if you need more." }, 400);
  const placeId = p.data.placeId || undefined;
  if (placeId && !(await ownPlaces(user.id)).some((pl) => pl.id === placeId)) return json({ error: "That place is not one of yours." }, 403);
  const box = await createBox(user.id, p.data.name, placeId);
  void buildImage(box.id, { ssid: p.data.ssid.trim() ? p.data.ssid : undefined, psk: p.data.psk || undefined });
  return json({ id: box.id }, 201);
}
