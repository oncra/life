// Wall-clock helpers for one IANA zone, without a library and without locale formatting (the node dashboard renders
// the same labels on the server and in the browser, so the text is built from numeric parts, never from Intl's
// own date strings, which differ between ICU versions). Timestamps in the database are UTC.

/** Every node so far stands in the Netherlands. A zone per place comes when a node stands elsewhere. */
export const DISPLAY_ZONE = "Europe/Amsterdam";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string) {
  let f = fmts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    fmts.set(zone, f);
  }
  return f;
}

export type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number };

/** The wall clock in `zone` at instant `t` (epoch ms). */
export function wall(t: number, zone: string): Wall {
  const p: Record<string, number> = {};
  for (const x of fmt(zone).formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second, wd: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}

/** The zone's offset from UTC at `t`, in ms (CEST is 7 200 000). */
export function offsetMs(t: number, zone: string): number {
  const w = wall(t, zone);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}

/** The local midnight at or before `t`. */
export function dayStart(t: number, zone: string): number {
  const w = wall(t, zone);
  // the instant of that wall-clock midnight: guessed with the offset now, corrected once if a DST change sits between
  let guess = Date.UTC(w.y, w.mo - 1, w.d) - offsetMs(t, zone);
  const g = wall(guess, zone);
  if (g.d !== w.d || g.h !== 0) guess = Date.UTC(w.y, w.mo - 1, w.d) - offsetMs(guess, zone);
  return guess;
}

/** Local midnights from the day of `from` up to `to`, at most 400. */
export function dayStarts(from: number, to: number, zone: string): number[] {
  const out: number[] = [];
  let t = dayStart(from, zone);
  for (let i = 0; i < 400 && t <= to; i++) {
    out.push(t);
    t = dayStart(t + 36 * 3600e3, zone);
  }
  return out;
}

const two = (n: number) => String(n).padStart(2, "0");
/** "Sat 11 Oct" */
export function dayLabel(t: number, zone: string): string {
  const w = wall(t, zone);
  return `${WD[w.wd]} ${w.d} ${MON[w.mo - 1]}`;
}
/** "18:19" */
export function clockLabel(t: number, zone: string): string {
  const w = wall(t, zone);
  return `${two(w.h)}:${two(w.mi)}`;
}
/** "Sat 11 Oct 18:19" */
export function fmtTime(t: number, zone: string): string {
  return `${dayLabel(t, zone)} ${clockLabel(t, zone)}`;
}

/** "2 h ago", "just now", "3 days ago". */
export function ago(t: number | null | undefined, now: number): string {
  if (!t) return "never";
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Hours as "7 h 20 min" or "3 days". */
export function spanLabel(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${two(m % 60)} min` : `${h} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export type Tick = { t: number; label: string; major: boolean };

/** Axis ticks for a time span: hours under three days, local midnights beyond, thinned so about ten remain. */
export function timeTicks(from: number, to: number, zone: string): Tick[] {
  const span = to - from;
  if (span <= 3 * 864e5) {
    const stepH = span <= 30 * 3600e3 ? 3 : 6;
    const out: Tick[] = [];
    let t = dayStart(from, zone);
    for (let i = 0; i < 200 && t <= to; i++) {
      if (t >= from) {
        const w = wall(t, zone);
        out.push({ t, label: w.h === 0 ? dayLabel(t, zone) : `${two(w.h)}:00`, major: w.h === 0 });
      }
      t += stepH * 3600e3;
    }
    return out;
  }
  const days = dayStarts(from, to, zone).filter((t) => t >= from);
  const every = days.length > 40 ? 7 : days.length > 16 ? 2 : 1;
  return days.filter((_, i) => i % every === 0).map((t) => ({ t, label: dayLabel(t, zone), major: true }));
}
