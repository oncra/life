import { z } from "zod";
import { json, unauthorized } from "@/lib/auth";
import { findPlace } from "@/lib/places";
import { canManage, canSeeExact } from "@/lib/privacy";
import { DEMO_MAX_H, demoData, setDemo } from "@/lib/node-demo";
export const dynamic = "force-dynamic";

/** The node's demo page data (src/lib/node-demo.ts), polled every few seconds. Public like the dashboard; where the node
 * is now is in it only while a manager's demo runs. POST {hours} starts a demo (and keeps the node on that long), DELETE
 * ends it: someone who manages the place, signed in or with a managing key. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  return json(await demoData(place, await canSeeExact(place, req)), 200, { "cache-control": "no-store" });
}

const Body = z.object({ hours: z.number().min(0.25).max(DEMO_MAX_H) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  if (!(await canManage(place, req))) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: `hours between 0.25 and ${DEMO_MAX_H}` }, 400);
  const until = await setDemo(place, parsed.data.hours);
  return json({ demo: { on: true, until }, note: "The node stays on until then once it has posted; start the demo before you press its button." });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await findPlace(id);
  if (!place) return json({ error: "not found" }, 404);
  if (!(await canManage(place, req))) return unauthorized();
  await setDemo(place, null);
  return json({ demo: { on: false, until: null } });
}
