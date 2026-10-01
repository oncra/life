import { json } from "@/lib/auth";
import { endSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await endSession();
  return json({ ok: true });
}
