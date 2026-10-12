// The listening schedule (content/spec.md, section 2.2): the hours of a day that the readings count, the same at every
// place and in every year. The node's own scheduler implements the same rule (node/image/life-schedule-wpi.py); a node
// may listen longer than this core (its extra hours, when its battery can carry them) and other recorders may listen
// all day, but diversity, renewal and the detection half of autonomy only see detections inside these windows, so a
// node with a weak panel, a station that never sleeps and a node in a sunny year are counted on the same hours.
//
//   March to October      4 h from civil dawn (6 h in May, June and July) and 1 h from sunset
//   November to February  2 h from sunrise
//
// South of the equator the months are six on. Windows are computed per UTC day from the place's centroid; the
// node computes them with astral, and the two agree to a minute or two.
import { sunAt } from "./sun";

const H = 36e5;
const DAY = 864e5;
export type Window = [number, number];

function seasonMonth(t: number, lat: number): number {
  const m = new Date(t).getUTCMonth() + 1;
  return lat >= 0 ? m : ((m + 5) % 12) + 1;
}

/** The core listening windows (epoch ms) of the UTC day that contains `t`. */
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
  const dawnCore = m >= 5 && m <= 7 ? 6 : 4;
  if (e <= a + 6 * H) return [[a, e + H]]; // days too short for two windows: one, dawn to the end of the dusk core
  return [[a, a + dawnCore * H], [e, e + H]];
}

/** Whether a detection at `ts` falls inside the core windows of its place. */
export function inCore(ts: number, lat: number, lon: number): boolean {
  for (const d of [ts, ts - DAY]) {
    for (const [s, e] of coreWindows(d, lat, lon)) if (ts >= s && ts < e) return true;
  }
  return false;
}

/** All core windows that touch [from, to], in order. */
export function coreWindowsBetween(from: number, to: number, lat: number, lon: number): Window[] {
  const out: Window[] = [];
  for (let d = Math.floor(from / DAY) - 1; d <= Math.floor(to / DAY); d++) {
    for (const w of coreWindows(d * DAY, lat, lon)) if (w[1] > from && w[0] < to) out.push(w);
  }
  return out;
}

/** The core windows of every UTC day from the day before `from` to the day of `to`, as four parallel arrays indexed by
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
