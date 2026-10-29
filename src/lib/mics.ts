/**
 * The microphones' check. A standard node has two microphones: the AudioMoth, which hears its birds and bats, and the
 * I2S microphone beside it as a witness (node/life-mic.py). Both hear the same air, so the difference between their
 * sound levels in a 1/3 octave band is a fixed number on a healthy node. Each day the node sends the median of that
 * difference per band (`metrics.mics` on the heartbeat, AudioMoth minus I2S, dB). A covered port, water behind a
 * membrane or a failing microphone moves it; the weather, the season and the birds do not, because they reach both.
 *
 * A day is judged against the node's own earlier days: the median difference of each bird band over the last weeks.
 * Two or more bird bands that moved MIC_DRIFT_DB the same way open a MIC alert, naming the microphone that now hears
 * less against the other; all bird bands back within MIC_OK_DB resolve it. A microphone that gave no levels at all
 * for a quarter of an hour in a day while the other did opens one too. A node is not judged before it has
 * MIC_MIN_DAYS days of at least MIC_MIN_N readings.
 */

export type MicDay = {
  day: string;
  n: number;
  bands: number[];
  diff: (number | null)[];
  a?: (number | null)[];
  i?: (number | null)[];
  fa?: (number | null)[];
  fi?: (number | null)[];
  missing?: string[];
  at?: string;
};

export type Mic = "audiomoth" | "i2s";

export type MicVerdict =
  | { state: "learning"; days: number }
  | { state: "missing"; mic: Mic }
  | { state: "ok"; delta: Record<string, number> }
  | { state: "watch"; delta: Record<string, number> }
  | { state: "drift"; mic: Mic; db: number; bands: number[]; delta: Record<string, number> };

export const MIC_DRIFT_DB = Number(process.env.MIC_DRIFT_DB ?? 6);
export const MIC_OK_DB = Number(process.env.MIC_OK_DB ?? 3);
export const MIC_MIN_DAYS = Number(process.env.MIC_MIN_DAYS ?? 5);
export const MIC_MIN_N = Number(process.env.MIC_MIN_N ?? 10);
export const MIC_HISTORY_DAYS = 28;
/** The bands birds sing in; the check is read there, where both microphones have sound to compare. */
export const BIRD_BANDS = [1000, 2000, 4000, 8000];

export const MIC_NAMES: Record<Mic, string> = { audiomoth: "AudioMoth", i2s: "I2S microphone" };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function isDay(x: unknown): x is MicDay {
  const d = x as MicDay;
  return !!d && typeof d.day === "string" && typeof d.n === "number" && Array.isArray(d.bands) && Array.isArray(d.diff);
}

/** One check per day: the node sends a day's check more than once while the day fills; the fullest one stands. */
export function byDay(checks: unknown[]): MicDay[] {
  const best = new Map<string, MicDay>();
  for (const c of checks) {
    if (!isDay(c)) continue;
    const had = best.get(c.day);
    if (!had || c.n >= had.n) best.set(c.day, c);
  }
  return [...best.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function at(d: MicDay, hz: number): number | null {
  const k = d.bands.indexOf(hz);
  const v = k < 0 ? null : d.diff[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** How today's difference stands against the node's own earlier days. */
export function micVerdict(history: unknown[], today: MicDay): MicVerdict {
  const miss = (today.missing ?? []).find((m): m is Mic => m === "audiomoth" || m === "i2s");
  if (miss) return { state: "missing", mic: miss };
  const past = byDay(history).filter((d) => d.day < today.day && d.n >= MIC_MIN_N);
  if (today.n < MIC_MIN_N || past.length < MIC_MIN_DAYS) return { state: "learning", days: past.length };
  const delta: Record<string, number> = {};
  for (const hz of BIRD_BANDS) {
    const now = at(today, hz);
    const base = median(past.map((d) => at(d, hz)).filter((v): v is number => v !== null));
    if (now !== null && base !== null) delta[hz] = Math.round((now - base) * 10) / 10;
  }
  const moved = Object.entries(delta).filter(([, d]) => Math.abs(d) >= MIC_DRIFT_DB);
  const down = moved.filter(([, d]) => d < 0);
  const up = moved.filter(([, d]) => d > 0);
  if (down.length >= 2 || up.length >= 2) {
    // AudioMoth minus I2S fell: the AudioMoth now hears less than it did against the I2S microphone; rose: the reverse
    const side = down.length >= up.length ? down : up;
    const db = Math.round((side.reduce((s, [, d]) => s + Math.abs(d), 0) / side.length) * 10) / 10;
    return { state: "drift", mic: side === down ? "audiomoth" : "i2s", db, bands: side.map(([hz]) => Number(hz)), delta };
  }
  const all = Object.values(delta);
  return all.length && all.every((d) => Math.abs(d) < MIC_OK_DB) ? { state: "ok", delta } : { state: "watch", delta };
}

/** The line a steward reads, in the notification and on the place page. */
export function micText(detail: { state?: string; mic?: string; db?: number; bands?: number[] } | null): string {
  const name = MIC_NAMES[(detail?.mic as Mic) ?? "audiomoth"] ?? "a microphone";
  if (detail?.state === "missing") return `the ${name} gave no sound levels for a quarter of an hour while the other did. Check that it is plugged in.`;
  const bands = (detail?.bands ?? []).map((hz) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`)).join(", ");
  return `the ${name} hears ${detail?.db ?? "?"} dB less than usual next to the other microphone${bands ? ` (${bands})` : ""}. Check its port for dirt, water or a web.`;
}
