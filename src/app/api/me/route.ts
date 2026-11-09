import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// For the header's account button (src/components/AccountLink.tsx): only whether this browser is signed in.
export async function GET() {
  const user = await currentUser().catch(() => null);
  return NextResponse.json({ signedIn: Boolean(user) }, { headers: { "cache-control": "no-store" } });
}
