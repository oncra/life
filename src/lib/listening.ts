// The listening schedule (content/spec.md, section 2.2): the hours of a day that the readings count, the same at every
// place, on every day of a season and in every year. The node's own scheduler listens to exactly these windows
// (node/image/life-schedule-wpi.py); other recorders may listen all day, but diversity, renewal and the detection half
// of autonomy only see detections inside these windows, so a node and a station that never sleeps are counted on the
// same hours. (Until 13 October 2026 the dawn window was 6 h in May to July and a node could add extra hours.) A node
// whose owner turned on the meadow-bird window listens after its dusk window too (src/lib/night.ts); never counted.
//
//   March to October      4 h from civil dawn and 1 h from sunset
//   November to February  2 h from sunrise
//
// South of the equator the months are six on. Windows are computed per UTC day from the place's centroid; the
// node computes them with astral, and the two agree to a minute or two.
import { sunAt } from "./sun";
import { offsetMs } from "./clock";

const H = 36e5;
const DAY = 864e5;
export type Window = [number, number];

function seasonMonth(t: number, lat: number): number {
  const m = new Date(t).getUTCMonth() + 1;
  return lat >= 0 ? m : ((m + 5) % 12) + 1;
}

/** The listening windows (epoch ms) of the UTC day that contains `t`. */
export function coreWindows(t: number, lat: number, lon: number): Window[] {
  const d0 = Math.floor(t / DAY) * DAY;
  const m = seasonMonth(d0 + 12 * H, lat);
  const sun = sunAt(d0, lat, lon, -0.833);
  const solarNoon = d0 + 12 * H - (lon / 15) * H; // the fallbacks below are relative to it: far north, no sunrise or dawn
  if (m === 11 || m === 12 || m === 1 || m === 2) {
    const s = sun ? sun.rise : solarNoon - 4 * H;
    return [[s, s + 2 * H]];
  }
  const civil = sunAt(d0, lat, lon, -6);
  const a = civil ? civil.rise : solarNoon - 7 * H;
  const e = sun ? sun.set : solarNoon + 9 * H;
  if (e <= a + 4 * H) return [[a, e + H]]; // days too short for two windows: one, from dawn to the end of the dusk window
  return [[a, a + 4 * H], [e, e + H]];
}

/** Whether a detection at `ts` falls inside the listening windows of its place. */
export function inCore(ts: number, lat: number, lon: number): boolean {
  for (const d of [ts, ts - DAY]) {
    for (const [s, e] of coreWindows(d, lat, lon)) if (ts >= s && ts < e) return true;
  }
  return false;
}

/** All listening windows that touch [from, to], in order. */
export function coreWindowsBetween(from: number, to: number, lat: number, lon: number): Window[] {
  const out: Window[] = [];
  for (let d = Math.floor(from / DAY) - 1; d <= Math.floor(to / DAY); d++) {
    for (const w of coreWindows(d * DAY, lat, lon)) if (w[1] > from && w[0] < to) out.push(w);
  }
  return out;
}

/** The listening windows of every UTC day from the day before `from` to the day of `to`, as four parallel arrays indexed by
 *  day (first and second window, start and end, ISO strings; an absent window is an empty one at the epoch), and the
 *  epoch day of index 0. For SQL: a detection's day index is floor(epoch seconds / 86400) - day0, so the test is two
 *  array lookups per row and the previous day's second window, never a scan of all windows. */
export function coreWindowArrays(from: number, to: number, lat: number, lon: number) {
  const day0 = Math.floor(from / DAY) - 1;
  const none = new Date(0).toISOString();
  const s1: string[] = [], e1: string[] = [], s2: string[] = [], e2: string[] = [];
  for (let d = day0; d <= Math.floor(to / DAY); d++) {
    const w = coreWindows(d * DAY, lat, lon);
    s1.push(new Date(w[0][0]).toISOString()); e1.push(new Date(w[0][1]).toISOString());
    s2.push(w[1] ? new Date(w[1][0]).toISOString() : none); e2.push(w[1] ? new Date(w[1][1]).toISOString() : none);
  }
  return { day0, s1, e1, s2, e2 };
}

// --- the windows as rules, for the nodes ---
//
// A node is told the method's windows as rules (node/image/life-schedule-wpi.py reads them; life-config takes them
// from the oracle's answer to a heartbeat, src/lib/node-config.ts): a length from a moment of the sun or the clock, in
// some months. METHOD_RULES are the windows above, the ones the readings count, written as rules; every node gets them,
// so a new version of the method reaches every node without a visit. coreWindows stays the method itself, and
// `npm run config:test` checks that METHOD_RULES give exactly its windows: change the two together, with the spec.
// What a node listens to beyond them is the owner's meadow-bird window (src/lib/night.ts), never counted.

export type Anchor = "dawn" | "sunrise" | "noon" | "sunset" | "dusk" | "clock";
export type WindowRule = { name: string; months: string | number[]; from: Anchor; at?: string; offset?: number; min: number };
export type RuleWindow = { name: string; start: number; end: number };

export const METHOD_RULES: WindowRule[] = [
  { name: "dawn", months: "3-10", from: "dawn", min: 240 },
  { name: "dusk", months: "3-10", from: "sunset", min: 60 },
  { name: "winter", months: "11-2", from: "sunrise", min: 120 },
];

/** "3-10" -> March to October, "11-2" -> November to February, "6" -> June, [4, 5]; null when it is none of those. */
export function monthsOf(v: unknown): Set<number> | null {
  if (Array.isArray(v)) return v.length && v.every((m) => Number.isInteger(m) && m >= 1 && m <= 12) ? new Set(v as number[]) : null;
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  if (a < 1 || a > 12 || b < 1 || b > 12) return null;
  const n = (((b - a) % 12) + 12) % 12 + 1;
  return new Set(Array.from({ length: n }, (_, i) => ((a - 1 + i) % 12) + 1));
}

function localAt(d0: number, hhmm: string, zone: string): number {
  const [h, mi] = hhmm.split(":").map(Number);
  const noon = d0 + 12 * H;
  return d0 + h * H + mi * 6e4 - offsetMs(noon, zone);
}

/** The windows `rules` give on the UTC day that contains `t` (epoch ms), worked out as coreWindows works out the
 *  method's: the same sun, the same fallbacks far north. Windows that overlap become one, named after both, as on the
 *  node (where the sun sets within three hours of civil dawn, far north, that one runs on to the dawn window's end,
 *  and coreWindows stops at the dusk window's). A clock rule is local time in `zone`. */
export function ruleWindows(t: number, lat: number, lon: number, rules: WindowRule[], zone = "Europe/Amsterdam"): RuleWindow[] {
  const d0 = Math.floor(t / DAY) * DAY;
  const m = seasonMonth(d0 + 12 * H, lat);
  const sun = sunAt(d0, lat, lon, -0.833), civil = sunAt(d0, lat, lon, -6);
  const solarNoon = d0 + 12 * H - (lon / 15) * H;
  const moment: Record<Exclude<Anchor, "clock">, number> = {
    dawn: civil ? civil.rise : solarNoon - 7 * H,
    sunrise: sun ? sun.rise : solarNoon - 4 * H,
    noon: sun ? (sun.rise + sun.set) / 2 : solarNoon,
    sunset: sun ? sun.set : solarNoon + 9 * H,
    dusk: civil ? civil.set : solarNoon + 10 * H,
  };
  const ws: RuleWindow[] = [];
  for (const r of rules) {
    if (!monthsOf(r.months)?.has(m)) continue;
    const a = r.from === "clock" ? localAt(d0, r.at ?? "00:00", zone) : moment[r.from];
    const s = a + (r.offset ?? 0) * 6e4;
    ws.push({ name: r.name, start: s, end: s + r.min * 6e4 });
  }
  ws.sort((x, y) => x.start - y.start);
  const out: RuleWindow[] = [];
  for (const w of ws) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      last.name += `+${w.name}`;
    } else out.push({ ...w });
  }
  return out;
}
