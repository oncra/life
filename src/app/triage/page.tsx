import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { canSeeExact } from "@/lib/privacy";
import { CLIP_KEEP_DAYS } from "@/lib/clips";
import { SignIn } from "@/components/BoxApp";
import { Triage, type TriageSpecies } from "@/components/Triage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Triage: was the detector right?",
  description: "Listen to the clips a Life Node on the bench kept, species by species, and say whether the detector was right.",
  robots: { index: false, follow: false },
};

// Clips from a node on the bench, grouped by species, for the people who may see its place exactly.
export default async function TriagePage() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
        <SignIn title="Triage" intro="Sign in with your email to hear the clips a Life Node kept and say whether the detector was right. We send you a six-digit code; there is no password." />
      </div>
    );
  }
  const devices = await prisma.device.findMany({ where: { clips: { some: {} } }, include: { place: true } });
  const allowed = (await Promise.all(devices.map(async (d) => ((await canSeeExact(d.place)) ? d : null)))).filter((d) => d !== null);
  const ids = allowed.map((d) => d.id);
  const [clips, reported, names] = await Promise.all([
    prisma.clip.findMany({ where: { deviceId: { in: ids } }, include: { reviews: true }, orderBy: [{ confidence: "desc" }] }),
    prisma.soundDetection.groupBy({ by: ["scientific"], where: { deviceId: { in: ids }, test: false }, _count: { _all: true } }),
    prisma.soundDetection.findMany({ where: { deviceId: { in: ids } }, distinct: ["scientific"], select: { scientific: true, species: true }, orderBy: { ts: "desc" } }),
  ]);
  const count = new Map(reported.map((r) => [r.scientific ?? "", r._count._all]));
  const common = new Map(names.filter((n) => n.scientific && n.species !== n.scientific).map((n) => [n.scientific as string, n.species]));
  // the cut-out and the Dutch name the worker keeps per species (src/lib/species-image.ts), found by scientific name
  const sci = [...new Set(clips.map((c) => c.scientific))];
  const pictures = await prisma.speciesImage.findMany({
    where: { OR: [{ scientific: { in: sci } }, { species: { in: sci } }] },
    select: { id: true, species: true, scientific: true, status: true, width: true, height: true, author: true, license: true, sourceUrl: true, names: true },
  });
  const look = new Map<string, { image: TriageSpecies["image"]; nl: string | null }>();
  for (const p of pictures) {
    const key = p.scientific ?? p.species;
    const had = look.get(key) ?? { image: null, nl: null };
    const nl = (p.names as Record<string, string> | null)?.nl ?? null;
    look.set(key, {
      image: had.image ?? (p.status === "ready" ? { id: p.id, width: p.width, height: p.height, author: p.author, license: p.license, sourceUrl: p.sourceUrl } : null),
      nl: had.nl ?? nl,
    });
  }
  const groups = new Map<string, TriageSpecies>();
  for (const c of clips) {
    const g = groups.get(c.scientific) ?? {
      scientific: c.scientific, name: c.species ?? common.get(c.scientific) ?? null, nl: look.get(c.scientific)?.nl ?? null,
      image: look.get(c.scientific)?.image ?? null, reported: count.get(c.scientific) ?? 0, clips: [],
    };
    const mine = c.reviews.find((r) => r.userId === user.id);
    const others = c.reviews.filter((r) => r.userId !== user.id);
    g.clips.push({
      id: c.id,
      ts: c.ts.toISOString(),
      confidence: c.confidence,
      detector: c.detector,
      source: c.source,
      fromS: c.fromS,
      toS: c.toS,
      expansion: c.expansion,
      hasSound: c.file !== null,
      mine: mine ? { verdict: mine.verdict, actual: mine.actual, note: mine.note } : null,
      others: { right: others.filter((r) => r.verdict === "right").length, wrong: others.filter((r) => r.verdict === "wrong").length, unsure: others.filter((r) => r.verdict === "unsure").length },
    });
    groups.set(c.scientific, g);
  }
  const species = [...groups.values()].sort((a, b) => b.reported - a.reported || b.clips.length - a.clips.length || a.scientific.localeCompare(b.scientific));
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Triage: was the detector right?</h1>
      <p className="mt-2 text-muted text-sm">
        Clips a Life Node kept while it stood on the bench{allowed.length ? ` (${allowed.map((d) => d.place.name).join(", ")})` : ""}: per species up to five
        in each score band of 0.1, so the low scores are heard as well as the high ones. Listen, look at the spectrogram if it helps, and say whether
        it is the species named. Each clip starts a second before the detected part and stops a second after it, and every clip is
        brought to the same loudness, so the quieter microphone is heard as well as the louder one. Your verdicts set each species&apos; own
        threshold. The sound is deleted after {CLIP_KEEP_DAYS} days; the verdicts stay.
      </p>
      {species.length === 0 ? (
        <p className="mt-6">No clips yet. They arrive a few hours after a node on the bench has heard something.</p>
      ) : (
        <Triage species={species} />
      )}
      <div className="mt-8 text-sm"><Link href="/me" className="underline">Your places</Link></div>
    </div>
  );
}
