import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canManage, canSeeExact } from "@/lib/privacy";
import { demoData } from "@/lib/node-demo";
import DemoBoard from "@/components/node/DemoBoard";
export const dynamic = "force-dynamic";

// The node's demo board: public like its dashboard. Where the node is now shows only while a demo a manager started
// runs (Place.demoUntil); the start button is for those who manage the place.

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await prisma.place.findFirst({ where: { OR: [{ slug }, { id: slug }] }, select: { name: true } });
  return { title: p ? `Live: Life Node at ${p.name}` : "Life Node live", description: "The birds a Life Node hears, as it hears them." };
}

export default async function DemoPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { lang } = await searchParams;
  const place = await prisma.place.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
  if (!place) notFound();
  const [exact, owner] = await Promise.all([canSeeExact(place), canManage(place)]);
  const initial = await demoData(place, exact);
  return <DemoBoard initial={initial} src={`/api/v1/places/${place.slug}/node/demo`} canRun={!!owner} lang={lang === "en" ? "en" : "nl"} />;
}
