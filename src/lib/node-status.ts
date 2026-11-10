// The node's state now, for the status panel at the top of the node dashboard (src/components/node/NodeStatus.tsx).
// Read from what the node posted, nothing modelled: while it is on WiFi or a cable, its live posts (every LIVE_EVERY_S
// seconds, node/life-live.py; the device keeps the latest and the last fifteen minutes, never more); otherwise its last
// heartbeat, which comes every three hours over 4G. No database here, so the browser can use it too; `nodeStatus` in
// src/lib/node.ts gathers the input. Public like the dashboard: no cell id, no WiFi name, nothing about where it stands.
import { batteryOf } from "./battery";
import { METHOD_RULES, ruleWindows } from "./listening";
import { POST_EVERY_H } from "./node-signal";

/** A node on WiFi or a cable posts live this often (node/life-live.py); on 4G it never does, to spare the SIM. */
export const LIVE_EVERY_S = 20;
/** A live post counts as live this long: after four missed ones the panel falls back to the last heartbeat. */
export const LIVE_FRESH_S = 90;
/** Live samples the device keeps for the panel's lines: fifteen minutes at LIVE_EVERY_S. */
export const LIVE_KEEP = 45;
const H = 3600e3;
const DAY = 864e5;

export const OPERATORS: Record<string, string> = { "20404": "Vodafone NL", "20408": "KPN", "20416": "Odido (T-Mobile NL)" };

export type Pt = [number, number];
export type Via = "wifi" | "lan" | "4g";
export type StatusState = "live" | "listening" | "awake" | "on" | "asleep" | "saving" | "quiet" | "silent" | "never";
/** One live sample for the lines: [t, piW, cpuTempC, battery or supply volts, rsrp] */
export type LiveSample = [number, number | null, number | null, number | null, number | null];
/** What the device keeps from the live posts (Device.live): the latest, and the samples of the last fifteen minutes. */
export type LiveRow = { at: number; net: { via: Via | null; dBm: number | null }; metrics: Record<string, unknown>; cell: Record<string, unknown> | null; hist: LiveSample[] };
export type SoundNow = {
  /** species heard today (local) and in the past seven days, test detections left out */
  today: number; week: number; detectionsToday: number;
  last: { species: string; t: number } | null;
  /** detections in each of the last 24 hours, oldest first */
  perHour: number[];
};
export type StatusBeat = { t: number; event: string | null; cell: Record<string, unknown> | null; metrics: Record<string, unknown> | null };
export type StatusInput = {
  now: number; lat: number; lon: number; zone: string;
  /** the last heartbeats, oldest first */
  beats: StatusBeat[];
  live: LiveRow | null;
  /** whether the node has ever posted live: it runs life-live, so on WiFi or a cable it reports every LIVE_EVERY_S */
  liveEver: boolean;
  /** the last time any device on the place posted anything: a station that sends detections without heartbeats */
  seenAt: number | null;
  /** the owner's meadow-bird window when it is on: the next one that has not ended (the node calls it "night") */
  night: [number, number] | null;
  sound: SoundNow;
  /** per soil probe, shallow first: its readings of the last two days, oldest first (a probe without one drops out) */
  soil: { depthCm: number | null; rows: { t: number; vwc: number | null; tempC: number | null }[] }[];
};

export type NodeStatusOut = {
  now: number;
  zone: string;
  state: StatusState;
  /** what the numbers come from: a live post, the last heartbeat, or nothing yet */
  source: "live" | "post" | null;
  liveEver: boolean;
  /** when the numbers were measured (the oracle's clock for a live post) */
  at: number | null;
  /** the last heartbeat, whatever the source */
  postAt: number | null;
  /** the link the numbers came over, when the node says */
  via: Via | null;
  /** the listening window the node said it is in (its own word: life-window decides it on the node; "night" is the
   * owner's meadow-bird window, names joined by "+" when windows meet), with its times at the place when the method's
   * windows or the night window give them; outside one, what it does */
  window: { name: string; start: number | null; end: number | null } | null;
  offWindow: string | null;
  /** why it last woke, as the Witty Pi says: alarm, button, power-connected, voltage-restored, ... */
  wake: string | null;
  /** when it booted: the time of the numbers less its uptime */
  upSince: number | null;
  /** what comes next: a post in the rhythm, the post at a window's end before it sleeps, or its wake for a window (for a
   * quiet node, the wake it has if it is asleep) */
  next: { kind: "post" | "sleep" | "wake"; at: number; name: string | null } | null;
  power: { v: number | null; src: "mppt" | "wittypi" | "usb" | null; piW: number | null; pvW: number | null; charge: string | null; yieldWh: number | null };
  /** the processor and the Witty Pi board; the Pi's throttle flags when the node sent them; the hottest it got (life-heat) */
  heat: { cpuC: number | null; boardC: number | null; throttle: { slowedNow: boolean; slowedSinceBoot: boolean; lowVoltage: boolean } | null; maxC: number | null };
  /** the 4G stick's cell: from the live post, else the latest post that has one (a shutdown post asks the stick
   * nothing, and a bench without the stick has none), with when it was read */
  link: { operator: string | null; rsrp: number | null; rssi: number | null; bars: number | null; wifiDbm: number | null; at: number | null };
  sound: SoundNow;
  soil: { depthCm: number | null; vwc: number | null; tempC: number | null; t: number }[];
  box: { diskFreeMb: number | null; unsent: number | null; clipsWaiting: number | null; load1: number | null };
  /** the lines in the tiles: the last fifteen minutes when live, else the last posts */
  spark: { span: "live" | "posts"; v: Pt[]; piW: Pt[]; pvW: Pt[]; cpuC: Pt[]; rsrp: Pt[]; vwc: Pt[] };
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Signal bars from LTE RSRP (or RSSI when the stick gives no RSRP): 4 from -80 dBm, 3 from -90, 2 from -100, 1 from -110. */
export function bars(rsrp: number | null, rssi: number | null): number | null {
  if (rsrp !== null) return rsrp >= -80 ? 4 : rsrp >= -90 ? 3 : rsrp >= -100 ? 2 : rsrp >= -110 ? 1 : 0;
  if (rssi !== null) return rssi >= -65 ? 4 : rssi >= -75 ? 3 : rssi >= -85 ? 2 : rssi >= -95 ? 1 : 0;
  return null;
}

/** The Pi's throttle flags (`get_throttled`): the low bits are now, from bit 16 since boot. Slowed is the clock capped,
 * throttled or held at the soft temperature limit; low voltage is the supply sagging under 4.63 V. */
export function throttleOf(v: unknown): { slowedNow: boolean; slowedSinceBoot: boolean; lowVoltage: boolean } | null {
  const s = str(v);
  const f = s && /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : num(v);
  if (f === null) return null;
  return { slowedNow: (f & 0xe) !== 0, slowedSinceBoot: (f & 0xe0000) !== 0, lowVoltage: (f & 0x10001) !== 0 };
}

export function viaOf(v: unknown): Via | null {
  return v === "wifi" || v === "lan" || v === "4g" ? v : null;
}

/** The method's windows (the ones every node listens to) of the day before, of and after `t`, in order. */
function windowsAround(t: number, lat: number, lon: number, zone: string) {
  return [-1, 0, 1].flatMap((d) => ruleWindows(t + d * DAY, lat, lon, METHOD_RULES, zone));
}

/** Everything the panel shows, from the input `nodeStatus` reads. */
export function statusFrom(i: StatusInput): NodeStatusOut {
  const last = i.beats.length ? i.beats[i.beats.length - 1] : null;
  const live = i.live && i.now - i.live.at < LIVE_FRESH_S * 1000 ? i.live : null;
  const m = live ? live.metrics : (last?.metrics ?? null);
  const at = live ? live.at : (last?.t ?? null);
  const via = live ? live.net.via : viaOf(obj(m?.net)?.via);
  // without heartbeats (a station that only sends detections), the age of its last post of any kind
  const age = last ? i.now - last.t : i.seenAt ? i.now - i.seenAt : Infinity;

  // the window it said it is in: the node's word counts (an owner's own schedule is the node's to know); the times
  // come from the method's windows around the moment it said so, or from the night window
  const winName = str(m?.window);
  const offWindow = str(m?.offWindow);
  let window: NodeStatusOut["window"] = null;
  if (winName && at !== null) {
    const parts = winName.split("+");
    const ws: { name: string; start: number; end: number }[] = windowsAround(at, i.lat, i.lon, i.zone);
    if (i.night) ws.push({ name: "night", start: i.night[0], end: i.night[1] });
    const w = ws.find((x) => x.name.split("+").some((n) => parts.includes(n)) && at >= x.start - 15 * 6e4 && at <= x.end + 15 * 6e4)
      ?? ws.find((x) => at >= x.start && at <= x.end);
    window = { name: winName, start: w?.start ?? null, end: w?.end ?? null };
  }
  // a window that ended a while ago without the post the node sends before it sleeps: that post is missing
  const ended = !live && !offWindow && window?.end != null && window.end + 15 * 6e4 < i.now;

  let state: StatusState;
  if (live) state = "live";
  else if (!last && !i.seenAt) state = "never";
  else if (last && last.event === "shutdown" && age < 36 * H) state = str(m?.wake) === "low-voltage" ? "saving" : "asleep";
  // in a window it listens for the readings; up outside one (a visit, kept awake, an alarm) it is awake; a desk node
  // without a scheduler says neither and is simply on
  else if (age < (POST_EVERY_H + 1) * H) state = window ? (ended ? "quiet" : "listening") : offWindow ? "awake" : "on";
  else if (age < 36 * H) state = "quiet";
  else state = "silent";

  let next: NodeStatusOut["next"] = null;
  if (state === "asleep" || state === "quiet") {
    const ws: { name: string; start: number }[] = windowsAround(i.now, i.lat, i.lon, i.zone);
    if (i.night) ws.push({ name: "night", start: i.night[0] });
    const w = ws.filter((x) => x.start > i.now).sort((a, b) => a.start - b.start)[0];
    if (w) next = { kind: "wake", at: w.start, name: w.name };
  } else if (state === "live" && window?.end != null && window.end > i.now) {
    next = { kind: "sleep", at: window.end, name: window.name };
  } else if ((state === "listening" || state === "awake" || state === "on") && last) {
    const post = last.t + POST_EVERY_H * H;
    next = window?.end != null && window.end <= post ? { kind: "sleep", at: window.end, name: window.name } : { kind: "post", at: post, name: null };
  }

  const uptimeS = num(m?.uptimeS);
  const running = state === "live" || state === "listening" || state === "awake" || state === "on";
  const batt = batteryOf(m);
  const vin = num(m?.vinV);
  const thr = throttleOf(m?.throttled);
  let maxC: number | null = null;
  for (let k = i.beats.length - 1; k >= 0 && maxC === null; k--) maxC = num(obj(i.beats[k].metrics?.heat)?.maxC);
  let cell = live?.cell ?? null, cellAt = cell ? live!.at : null;
  for (let k = i.beats.length - 1; k >= 0 && !cell; k--) if (i.beats[k].cell) { cell = i.beats[k].cell; cellAt = i.beats[k].t; }
  const plmn = cell?.plmn != null ? String(cell.plmn) : null;
  const rsrp = num(cell?.rsrp), rssi = num(cell?.rssi);

  const soilLast = i.soil
    .map((p) => ({ depthCm: p.depthCm, row: p.rows[p.rows.length - 1] }))
    .filter((p) => p.row && i.now - p.row.t < 2 * DAY)
    .map((p) => ({ depthCm: p.depthCm, vwc: p.row.vwc, tempC: p.row.tempC, t: p.row.t }));
  const vwc = (i.soil.find((p) => p.rows.some((r) => r.vwc !== null))?.rows ?? []).filter((r) => r.vwc !== null).map((r) => [r.t, r.vwc] as Pt);

  let spark: NodeStatusOut["spark"];
  if (live && live.hist.length >= 2) {
    const col = (k: 1 | 2 | 3 | 4) => live.hist.filter((s) => s[k] !== null).map((s) => [s[0], s[k]] as Pt);
    spark = { span: "live", v: col(3), piW: col(1), pvW: [], cpuC: col(2), rsrp: col(4), vwc };
  } else {
    const col = (f: (b: StatusBeat) => number | null) => i.beats.map((b) => [b.t, f(b)] as [number, number | null]).filter((p): p is Pt => p[1] !== null);
    spark = {
      span: "posts",
      v: col((b) => batteryOf(b.metrics)?.v ?? num(b.metrics?.vinV)), piW: col((b) => num(b.metrics?.piW)), pvW: col((b) => num(b.metrics?.pvW)),
      cpuC: col((b) => num(b.metrics?.cpuTempC)), rsrp: col((b) => num(b.cell?.rsrp)), vwc,
    };
  }

  return {
    now: i.now, zone: i.zone, state, source: live ? "live" : last ? "post" : null, liveEver: i.liveEver, at, postAt: last?.t ?? i.seenAt, via,
    window, offWindow, wake: str(m?.wake),
    upSince: running && uptimeS !== null && at !== null ? at - uptimeS * 1000 : null,
    next,
    power: { v: batt?.v ?? vin, src: batt?.src ?? (vin !== null ? "usb" : null), piW: num(m?.piW), pvW: num(m?.pvW), charge: str(m?.charge), yieldWh: num(m?.yieldTodayWh) },
    heat: { cpuC: num(m?.cpuTempC), boardC: num(m?.boxTempC), throttle: thr, maxC },
    link: { operator: plmn ? (OPERATORS[plmn] ?? `network ${plmn}`) : null, rsrp, rssi, bars: bars(rsrp, rssi), wifiDbm: via === "wifi" ? (live?.net.dBm ?? num(obj(m?.net)?.dBm)) : null, at: cell ? cellAt : null },
    sound: i.sound,
    soil: soilLast,
    box: { diskFreeMb: num(m?.diskFreeMb), unsent: num(m?.unsent), clipsWaiting: num(m?.clipsWaiting), load1: num(m?.load1) },
    spark,
  };
}

/** The live row a device keeps, as stored (Json), or null when it is missing or malformed. */
export function liveOf(v: unknown): LiveRow | null {
  const o = obj(v);
  const at = num(o?.at);
  if (!o || at === null) return null;
  const net = obj(o.net);
  const hist = Array.isArray(o.hist) ? (o.hist.filter((s) => Array.isArray(s) && s.length === 5 && typeof s[0] === "number") as LiveSample[]) : [];
  return { at, net: { via: viaOf(net?.via), dBm: num(net?.dBm) }, metrics: obj(o.metrics) ?? {}, cell: obj(o.cell), hist };
}
