// The meadow-bird window as the oracle works it out, for the node dashboard: the same rule the node applies in its own
// schedule (node/image/life-schedule-wpi.py), to a minute or two. No database here, so the owner's panel in the
// browser and the server share it (src/lib/node-night.ts has the settings, the heartbeat answer and the state).
//
// The window starts startMin minutes after sunset and ends startMin + lenMin minutes after it, on the dates from `from`
// to `to` (MM-DD, both included; a season may run over the new year). It never overlaps the listening windows the
// readings count: it starts no earlier than the end of the day's last one and ends at least NIGHT_GAP_MS before the
// next day's first, and what is left under NIGHT_MIN_MS is no window. Arithmetic in UTC epoch ms, like listening.ts.
import { dayLabel, dayStart, clockLabel, wall, DISPLAY_ZONE } from "./clock";
import { coreWindows, type Window } from "./listening";
import { sunAt } from "./sun";

export type NightSettings = { on: boolean; startMin: number; lenMin: number; from: string; to: string; battery: boolean; minV: number };

/** Off until the place's owner turns it on; then the hour after the dusk window, from the first godwits back to the end
 *  of June, and only on an evening the battery holds 13.1 V (the Witty Pi's reading, a few tenths under the battery). */
export const NIGHT_DEFAULTS: NightSettings = { on: false, startMin: 60, lenMin: 60, from: "03-25", to: "06-30", battery: true, minV: 13.1 };

const MIN = 6e4;
const H = 36e5;
const DAY = 864e5;
/** The window ends at least this long before the next day's first listening window. */
export const NIGHT_GAP_MS = 15 * MIN;
/** Less than this left between the core windows is no window. */
export const NIGHT_MIN_MS = 5 * MIN;

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** "03-25": a month and a day that exist in some year (29 February included). */
export function isMonthDay(s: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const mo = Number(m[1]), d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DAYS[mo - 1];
}

/** "03-25" as "25 Mar". */
export function mdLabel(md: string): string {
  const [m, d] = md.split("-").map(Number);
  return `${d} ${MON[m - 1]}`;
}

/** Whether month-day `md` lies in the season from `from` to `to`, both included; a season may run over the new year. */
export function inSeason(md: string, from: string, to: string): boolean {
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** The local calendar day of `t`: "YYYY-MM-DD" and its month-day. */
function localDay(t: number, zone: string): { date: string; md: string } {
  const w = wall(t, zone);
  return { date: `${w.y}-${two(w.mo)}-${two(w.d)}`, md: `${two(w.mo)}-${two(w.d)}` };
}

/** The meadow-bird window of the local day that contains `t`, or null: off, out of season, or no room left between the
 *  core windows. The sun is worked out for that calendar day, as the node does with its own clock. */
export function nightWindow(t: number, lat: number, lon: number, s: NightSettings, zone = DISPLAY_ZONE): Window | null {
  if (!s.on) return null;
  const w = wall(t, zone);
  if (!inSeason(`${two(w.mo)}-${two(w.d)}`, s.from, s.to)) return null;
  const ref = Date.UTC(w.y, w.mo - 1, w.d, 12);
  const sun = sunAt(ref, lat, lon, -0.833);
  // where the sun does not set, the same fallback as listening.ts: nine hours after solar noon
  const sunset = sun ? sun.set : Math.floor(ref / DAY) * DAY + 12 * H - (lon / 15) * H + 9 * H;
  const core = coreWindows(ref, lat, lon);
  const start = Math.max(sunset + s.startMin * MIN, core[core.length - 1][1]);
  const end = Math.min(sunset + (s.startMin + s.lenMin) * MIN, coreWindows(ref + DAY, lat, lon)[0][0] - NIGHT_GAP_MS);
  return end - start >= NIGHT_MIN_MS ? [start, end] : null;
}

/** The window that has not ended yet at `now`: the local day before's (one that runs past midnight), today's or tomorrow's. */
export function nextNight(now: number, lat: number, lon: number, s: NightSettings, zone = DISPLAY_ZONE): Window | null {
  const today = dayStart(now, zone);
  for (const d of [dayStart(today - H, zone), today, dayStart(today + 36 * H, zone)]) {
    const win = nightWindow(d + 12 * H, lat, lon, s, zone);
    if (win && win[1] > now) return win;
  }
  return null;
}

/** The first local day from the day of `t` on that lies in the season ("YYYY-MM-DD"), within a year; null if none. */
export function seasonStart(t: number, s: NightSettings, zone = DISPLAY_ZONE): string | null {
  let d = dayStart(t, zone);
  for (let i = 0; i < 370; i++) {
    const day = localDay(d + 12 * H, zone);
    if (inSeason(day.md, s.from, s.to)) return day.date;
    d = dayStart(d + 36 * H, zone);
  }
  return null;
}

/** What the oracle can say ahead of the night: the next window, or from when the season runs, or that it does not fit. */
export function nightPlan(now: number, lat: number, lon: number, s: NightSettings, zone = DISPLAY_ZONE): { tonight: { start: string; end: string } | null; seasonFrom: string | null; fits: boolean } {
  if (!s.on) return { tonight: null, seasonFrom: null, fits: true };
  const win = nextNight(now, lat, lon, s, zone);
  if (win) return { tonight: { start: new Date(win[0]).toISOString(), end: new Date(win[1]).toISOString() }, seasonFrom: null, fits: true };
  const tomorrow = dayStart(dayStart(now, zone) + 36 * H, zone);
  const from = seasonStart(tomorrow, s, zone);
  // in season tomorrow and still no window: the settings leave no room between the dusk window and the next dawn
  if (from === localDay(tomorrow + 12 * H, zone).date) return { tonight: null, seasonFrom: null, fits: false };
  return { tonight: null, seasonFrom: from, fits: true };
}

/** How the node's last meadow-bird window went, as its heartbeat says (`nightLast`). */
export type NightLast = { date: string | null; start: string | null; end: string | null; ran: string; v: number | null; minV: number | null; at: string } | null;

export function nightLastOf(v: unknown): NightLast {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const l = v as Record<string, unknown>;
  const iso = (x: unknown) => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const at = iso(l.at);
  if (!at || typeof l.ran !== "string") return null;
  return {
    date: typeof l.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.date) ? l.date : null, start: iso(l.start), end: iso(l.end),
    ran: l.ran, v: num(l.v), minV: num(l.minV), at,
  };
}

/** "21:47 to 22:47" */
export function spanText(start: string, end: string, zone = DISPLAY_ZONE): string {
  return `${clockLabel(Date.parse(start), zone)} to ${clockLabel(Date.parse(end), zone)}`;
}

/** "Sat 2 May: listened 21:47 to 22:47, battery 13.24 V", for the owner's panel and the public line alike. */
export function nightLastText(l: NonNullable<NightLast>, zone = DISPLAY_ZONE): string {
  const day = dayLabel(Date.parse(l.start ?? l.at), zone);
  const span = l.start && l.end ? ` ${spanText(l.start, l.end, zone)}` : "";
  const volts = (x: number) => `${x.toFixed(2).replace(/0$/, "")} V`;
  switch (l.ran) {
    case "listened": return `${day}: listened${span}${l.v !== null ? `, battery ${volts(l.v)}` : ""}`;
    case "battery": return `${day}: skipped for the battery${l.v !== null ? `: ${volts(l.v)}${l.minV !== null ? ` under ${volts(l.minV)}` : ""}` : ""}`;
    case "unknown": return `${day}: listened${span}; the battery could not be read`;
    case "kept": return `${day}: the alarm was silenced, so it stayed on${span ? ` (${span.trim()})` : ""}`;
    default: return `${day}: ${l.ran}`;
  }
}
