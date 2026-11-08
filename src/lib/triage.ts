import { prisma } from "./db";
import { canSeeExact } from "./privacy";
import type { TriageClip } from "@/components/Triage";

// The devices whose clips /triage shows, and which of them the person looking may judge (signed in and allowed to see
// the place exactly). Shared by the page, which lists species only, and /api/triage/clips, which brings one species'
// clips when its row is opened: with thousands of clips, sending them all with the page made it megabytes of HTML.
export async function triageDevices(userId: string | null) {
  const devices = await prisma.device.findMany({ where: { clips: { some: {} } }, include: { place: true } });
  const judge = new Set(
    userId ? (await Promise.all(devices.map(async (d) => ((await canSeeExact(d.place)) ? d.id : null)))).filter((d) => d !== null) : [],
  );
  return { devices, judge };
}

/** One species' clips, highest score first, as the triage page shows them. */
export async function triageClips(scientific: string, userId: string | null): Promise<TriageClip[]> {
  const { devices, judge } = await triageDevices(userId);
  const clips = await prisma.clip.findMany({
    where: { deviceId: { in: devices.map((d) => d.id) }, scientific },
    include: { reviews: true },
    orderBy: [{ confidence: "desc" }, { ts: "desc" }],
  });
  return clips.map((c) => {
    const mine = userId ? c.reviews.find((r) => r.userId === userId) : undefined;
    const others = c.reviews.filter((r) => r.userId !== userId);
    return {
      id: c.id,
      ts: c.ts.toISOString(),
      confidence: c.confidence,
      detector: c.detector,
      source: c.source,
      fromS: c.fromS,
      toS: c.toS,
      expansion: c.expansion,
      hasSound: c.file !== null,
      canJudge: judge.has(c.deviceId),
      mine: mine ? { verdict: mine.verdict, actual: mine.actual, note: mine.note } : null,
      others: {
        right: others.filter((r) => r.verdict === "right").length,
        wrong: others.filter((r) => r.verdict === "wrong").length,
        unsure: others.filter((r) => r.verdict === "unsure").length,
      },
    };
  });
}
