import { json } from "@/lib/auth";
import { nodeSignals } from "@/lib/node";
export const dynamic = "force-dynamic";
/** Every place with a device that has reported, as a signal for the map. Public: a place that hides its location or
 * is private gets a blurred point, the same one every time. */
export async function GET() {
  const items = await nodeSignals();
  return json({ count: items.length, items });
}
