import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { TRIAGE_MIN_DEFAULT, triageDevices, triageMin } from "@/lib/triage";
import { MinScore } from "@/components/MinScore";
import { CLIP_KEEP_DAYS } from "@/lib/clips";
import { SignIn } from "@/components/BoxApp";
import { Triage, type TriageSpecies } from "@/components/Triage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Triage: was the detector right?",
  description: "Listen to the clips a Life Node on the bench kept, species by species, and hear whether the detector was right.",
  robots: { index: false, follow: false },
};

// Clips from a node on the bench, grouped by species. Everyone may listen (Sven, 2026-11-02: read-only for every
// visitor); judging a clip takes a sign-in and the right to see its place exactly, as before (mayHear in lib/clips).
// The page shows no location: a clip says which node, never where it stands.
export default async function TriagePage({ searchParams }: { searchParams: Promise<{ min?: string }> }) {
  const min = triageMin((await searchParams).min);
  const pct = Math.round(min * 100);
  const user = await currentUser();
  const { devices: allowed, judge } = await triageDevices(user?.id ?? null);
  const ids = allowed.map((d) => d.id);
  // Species only: a row's clips come from /api/triage/clips when it is opened (thousands of clips made this page
  // megabytes of HTML and a long wait for the button that leads here).
  const [perSpecies, clipNames, mine, reported, names] = await Promise.all([
    prisma.clip.groupBy({ by: ["scientific"], where: { deviceId: { in: ids }, confidence: { gte: min } }, _count: { _all: true } }),
    prisma.clip.findMany({ where: { deviceId: { in: ids }, species: { not: null }, confidence: { gte: min } }, distinct: ["scientific"], select: { scientific: true, species: true }, orderBy: { confidence: "desc" } }),
    user
      ? prisma.clipReview.findMany({ where: { userId: user.id, clip: { deviceId: { in: ids }, confidence: { gte: min } } }, select: { verdict: true, clip: { select: { scientific: true } } } })
      : Promise.resolve([]),
    prisma.soundDetection.groupBy({ by: ["scientific"], where: { deviceId: { in: ids }, test: false }, _count: { _all: true } }),
    prisma.soundDetection.findMany({ where: { deviceId: { in: ids } }, distinct: ["scientific"], select: { scientific: true, species: true }, orderBy: { ts: "desc" } }),
  ]);
  const count = new Map(reported.map((r) => [r.scientific ?? "", r._count._all]));
  const common = new Map(names.filter((n) => n.scientific && n.species !== n.scientific).map((n) => [n.scientific as string, n.species]));
  const clipName = new Map(clipNames.map((c) => [c.scientific, c.species as string]));
  const tallies = new Map<string, Record<string, number>>();
  for (const r of mine) {
    const t = tallies.get(r.clip.scientific) ?? {};
    t[r.verdict] = (t[r.verdict] ?? 0) + 1;
    tallies.set(r.clip.scientific, t);
  }
  // the cut-out and the Dutch name the worker keeps per species (src/lib/species-image.ts), found by scientific name
  const sci = perSpecies.map((g) => g.scientific);
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
  const species: TriageSpecies[] = perSpecies
    .map((g) => ({
      scientific: g.scientific,
      name: clipName.get(g.scientific) ?? common.get(g.scientific) ?? null,
      nl: look.get(g.scientific)?.nl ?? null,
      image: look.get(g.scientific)?.image ?? null,
      reported: count.get(g.scientific) ?? 0,
      clipCount: g._count._all,
      mine: { right: tallies.get(g.scientific)?.right ?? 0, wrong: tallies.get(g.scientific)?.wrong ?? 0, unsure: tallies.get(g.scientific)?.unsure ?? 0 },
    }))
    .sort((a, b) => b.reported - a.reported || b.clipCount - a.clipCount || a.scientific.localeCompare(b.scientific));
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Triage: was the detector right?</h1>
      <MinScore value={pct} standard={TRIAGE_MIN_DEFAULT} />
      <p className="mt-2 text-muted text-sm">
        Clips a Life Node kept while it stood on the bench{allowed.length ? <> ({allowed.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link href={`/places/${d.place.slug}/node`} className="underline">{d.place.name}</Link></span>)})</> : null}: per species up to five
        in each score band of 0.1, so the low scores are heard as well as the high ones. Listen, look at the spectrogram if it helps, and say whether
        it is the species named. Anyone may listen; judging takes a sign-in. Each clip starts a second before the detected part and stops a second after it, and every clip is
        brought to the same loudness, so the quieter microphone is heard as well as the louder one. Your verdicts set each species&apos; own
        threshold. The sound is deleted after {CLIP_KEEP_DAYS} days; the verdicts stay.
      </p>
      <p className="mt-2 text-muted text-sm">
        Clips the detector scored under {pct}% are left out. {TRIAGE_MIN_DEFAULT}% is the usual starting point in the published work on
        BirdNET. In a German forest, the detector was right nine times out of ten for one species in ten from a score of 10%, for about a
        quarter from 50% and for about half from 90% (<a className="underline" href="https://doi.org/10.1111/ibi.13193" target="_blank" rel="noreferrer">Pérez-Granados 2023</a>,{" "}
        <a className="underline" href="https://doi.org/10.1002/rse2.385" target="_blank" rel="noreferrer">Singer et al. 2024</a>). The score is not a probability, and
        what it means differs per species (<a className="underline" href="https://doi.org/10.1007/s10336-024-02144-5" target="_blank" rel="noreferrer">Wood &amp; Kahl 2024</a>).
      </p>
      {!user && species.length > 0 ? (
        <details className="mt-4 rounded-lg border border-line bg-white p-4">
          <summary className="cursor-pointer font-medium">Sign in to judge the clips</summary>
          <div className="mt-3">
            <SignIn compact title="Sign in" intro="We send a six-digit code to your email; there is no password. You can judge the clips of the nodes whose place you may see exactly." />
          </div>
        </details>
      ) : null}
      {species.length === 0 ? (
        <p className="mt-6">{min > 0 ? `No clips scored ${pct}% or more. Lower the score above to hear more.` : "No clips yet. They arrive a few hours after a node on the bench has heard something."}</p>
      ) : (
        <Triage key={pct} species={species} judging={judge.size > 0} min={pct} />
      )}
      {user ? <div className="mt-8 text-sm"><Link href="/me" className="underline">Your places</Link></div> : null}
    </div>
  );
}
