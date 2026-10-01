import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { boxLive, boxOut } from "@/lib/boxout";
import { BoxApp } from "@/components/BoxApp";
import { ownPlaces } from "@/lib/places";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your Life Box: get its software",
  description: "Sign in with your email, name your box, give the WiFi it will use, and download a card image made for it.",
};

export default async function BoxPage() {
  const user = await currentUser();
  const boxes = user ? await prisma.box.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { place: { select: { slug: true, name: true } } } }) : [];
  const places = user ? await ownPlaces(user.id) : [];
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
      <BoxApp email={user?.email ?? null} places={places} initial={JSON.parse(JSON.stringify(await Promise.all(boxes.map(async (b) => ({ ...boxOut(b), live: await boxLive(b.placeId, b.hostname) })))))} />
    </div>
  );
}
