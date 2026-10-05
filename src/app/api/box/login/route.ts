import { z } from "zod";
import { json } from "@/lib/auth";
import { normalizeEmail, setSessionCookie, verifyLoginCode } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const p = z.object({ email: z.string().trim().email().max(200), code: z.string().trim().min(4).max(12) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Type the six digits from the mail." }, 400);
  const token = await verifyLoginCode(normalizeEmail(p.data.email), p.data.code);
  if (!token) return json({ error: "That code does not match, or it has expired. Ask for a new one." }, 401);
  await setSessionCookie(token);
  return json({ ok: true });
}
