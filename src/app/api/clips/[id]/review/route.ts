import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { mayHear, ReviewBody } from "@/lib/clips";
export const dynamic = "force-dynamic";

// The signed-in person's verdict on a clip: right, wrong or unsure, what it was instead and a note. A null verdict
// takes it back.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { id } = await params;
  const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true, deviceId: true } });
  if (!clip || !(await mayHear(clip.deviceId))) return json({ error: "not found" }, 404);
  const parsed = ReviewBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid body", issues: parsed.error.issues.slice(0, 5) }, 400);
  const { verdict, actual, note } = parsed.data;
  if (verdict === null) {
    await prisma.clipReview.deleteMany({ where: { clipId: clip.id, userId: user.id } });
    return json({ ok: true, review: null });
  }
  const clean = (s?: string) => (s?.trim() ? s.trim() : null);
  const r = await prisma.clipReview.upsert({
    where: { clipId_userId: { clipId: clip.id, userId: user.id } },
    create: { clipId: clip.id, userId: user.id, verdict, actual: clean(actual), note: clean(note) },
    update: { verdict, actual: clean(actual), note: clean(note) },
  });
  return json({ ok: true, review: { verdict: r.verdict, actual: r.actual, note: r.note } });
}
