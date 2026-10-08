import { z } from "zod";
import { json } from "@/lib/auth";
import { clearUnlockCookie, clientKey, passwordMatches, recordMiss, setUnlockCookie, tooManyMisses } from "@/lib/backlog";

export const dynamic = "force-dynamic";

// The board password, typed once: the cookie it leaves lets this browser change the board.
export async function POST(req: Request) {
  const key = clientKey(req);
  if (tooManyMisses(key)) return json({ error: "Too many wrong passwords. Try again in a quarter of an hour." }, 429);
  const p = z.object({ password: z.string().max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success || !passwordMatches(p.data.password)) {
    recordMiss(key);
    return json({ error: "That is not the password." }, 401);
  }
  await setUnlockCookie();
  return json({ ok: true });
}

// Lock again: forget the password in this browser.
export async function DELETE() {
  await clearUnlockCookie();
  return json({ ok: true });
}
