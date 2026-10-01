import { z } from "zod";
import { json } from "@/lib/auth";
import { normalizeEmail, sendLoginCode } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const p = z.object({ email: z.string().trim().email().max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "That does not look like an email address." }, 400);
  try {
    const r = await sendLoginCode(normalizeEmail(p.data.email));
    return r.ok ? json({ ok: true }) : json({ error: r.error }, 429);
  } catch (e) {
    console.error("login code:", e);
    return json({ error: "The mail could not be sent just now. Try again in a minute." }, 502);
  }
}
