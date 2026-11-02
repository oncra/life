import { z } from "zod";
import { prisma } from "./db";
import { isMonthDay, NIGHT_DEFAULTS, nightLastOf, nightPlan, type NightLast, type NightSettings } from "./night";

// The meadow-bird window of a Life Node: in spring black-tailed godwit, lapwing and snipe call most in the first hours
// of darkness, after the node's dusk window has ended, so a node may listen on for an hour or so for research at the
// place. The place's owner turns it on and sets it on the node dashboard; the node hears the settings with its next
// heartbeat answer and puts the window in its own schedule (node/image/life-schedule-wpi.py, life-window). Off by
// default, and outside the readings: listening.ts counts only the core windows, so a node that listens longer is read
// on the same hours as one that does not. The window's arithmetic is in src/lib/night.ts.

export { NIGHT_DEFAULTS };

const tenths = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
const MonthDay = z.string().refine(isMonthDay, "a date as MM-DD, for example 03-25");

/** PUT body of the owner's meadow-bird window: every field optional, a value sets it. */
export const NightBody = z.object({
  on: z.boolean().optional(),
  startMin: z.number().int("whole minutes").min(0, "the start is 0 to 360 minutes after sunset").max(360, "the start is 0 to 360 minutes after sunset").optional(),
  lenMin: z.number().int("whole minutes").min(15, "the window lasts 15 to 180 minutes").max(180, "the window lasts 15 to 180 minutes").optional(),
  from: MonthDay.optional(),
  to: MonthDay.optional(),
  battery: z.boolean().optional(),
  minV: z.number().min(12, "the battery level is 12.0 to 14.0 V").max(14, "the battery level is 12.0 to 14.0 V").refine(tenths, "volts to one decimal, for example 13.1").optional(),
});

type NightRow = { nightOn: boolean; nightStartMin: number; nightLenMin: number; nightFrom: string; nightTo: string; nightBattery: boolean; nightMinV: number; nightRev: number };

export const NIGHT_SELECT = { nightOn: true, nightStartMin: true, nightLenMin: true, nightFrom: true, nightTo: true, nightBattery: true, nightMinV: true, nightRev: true } as const;

export function settingsOf(d: NightRow): NightSettings {
  return { on: d.nightOn, startMin: d.nightStartMin, lenMin: d.nightLenMin, from: d.nightFrom, to: d.nightTo, battery: d.nightBattery, minV: d.nightMinV };
}

export type NightOut = { rev: number } & NightSettings;

/** The meadow-bird settings for the heartbeat answer, only when the node reports a rev (it runs a life-window that knows
 * the window; -1 for none yet) other than the current one. */
export function nightFor(d: NightRow, nodeRev: unknown): NightOut | undefined {
  if (typeof nodeRev !== "number" || nodeRev === d.nightRev) return undefined;
  return { rev: d.nightRev, ...settingsOf(d) };
}

/** What the owner sets and everyone may read on the node dashboard: the settings, whether the node has them yet, the
 * next window as the oracle works it out from the place's centroid, and how the last one went as the node said. */
export async function nightState(deviceId: string, now = Date.now()) {
  const [d, beats] = await Promise.all([
    prisma.device.findUniqueOrThrow({ where: { id: deviceId }, select: { ...NIGHT_SELECT, place: { select: { centroidLat: true, centroidLon: true } } } }),
    // a few, not one: a heartbeat sent without the night fields (an older program on the way down) should not hide them
    prisma.heartbeat.findMany({ where: { deviceId }, orderBy: { ts: "desc" }, take: 12, select: { ts: true, metrics: true } }),
  ]);
  const s = settingsOf(d);
  const metrics = beats.map((b) => ({ ts: b.ts, m: (b.metrics ?? {}) as Record<string, unknown> }));
  const withRev = metrics.find((b) => typeof b.m.nightRev === "number");
  const nodeRev = withRev ? (withRev.m.nightRev as number) : null;
  const last: NightLast = metrics.map((b) => nightLastOf(b.m.nightLast)).find((l) => l !== null) ?? null;
  return {
    device: deviceId, settings: s, rev: d.nightRev, nodeRev, nodeHas: nodeRev === d.nightRev, heardAt: (withRev ?? metrics[0])?.ts.toISOString() ?? null,
    last, ...nightPlan(now, d.place.centroidLat, d.place.centroidLon, s),
  };
}

export type NightState = Awaited<ReturnType<typeof nightState>>;
