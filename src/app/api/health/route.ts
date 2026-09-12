import { prisma } from "@/lib/db";
import { json } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [places, obs] = await Promise.all([prisma.place.count(), prisma.satelliteObs.count()]);
    return json({ ok: true, places, satelliteObservations: obs, time: new Date().toISOString() });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
