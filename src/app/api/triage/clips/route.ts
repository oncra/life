import { json } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { triageClips } from "@/lib/triage";
export const dynamic = "force-dynamic";

// One species' clips for the triage page, fetched when its row is opened. Open to every visitor, as the page is
// (2026-11-02); canJudge and the person's own verdicts follow the sign-in.
export async function GET(req: Request) {
  const scientific = new URL(req.url).searchParams.get("species")?.trim();
  if (!scientific) return json({ error: "name the species (species)" }, 400);
  const user = await currentUser();
  return json({ clips: await triageClips(scientific, user?.id ?? null) });
}
