import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { METHOD_RULES, monthsOf, ruleWindows, type WindowRule } from "./listening";

// Settings over the air: what a Life Node takes from the oracle with its answer to a heartbeat (node/life-config.py).
// The node reports the settings it runs as `cfgRev`; when the oracle's differ, the answer carries them, and only then:
// the method's listening windows as rules (METHOD_RULES, the same at every node, so a new version of the method reaches
// every node without a visit) and a short list of the node's own settings, which the place's owner sets. A few hundred
// bytes once per change, on a post that is made anyway: no extra connection, nothing on the SIM while nothing changes.
// The node checks everything again against its own list and bounds (the same as NODE_SETTINGS, `npm run config:test`
// compares them), refuses what is out of bounds, and goes back to its last good settings by itself when it hears
// nothing from the oracle in three wakes after a change. Nothing that keeps the link can be set this way: not the SIM,
// the network, the tokens, the oracle's address, the SSH keys or the software. A node's own extra listening is the
// meadow-bird window, which has its own settings and channel (src/lib/node-night.ts).

type Num = { kind: "num" | "int"; min: number; max: number };
type Enum = { kind: "enum"; options: string[] };
export type NodeSetting = (Num | Enum) & { key: string; group: string; label: string; what: string; when: "post" | "run" | "visit" | "wake" | "now" };

/** What the oracle may set, within what. The same list and bounds as SETTINGS in node/life-config.py. */
export const NODE_SETTINGS: NodeSetting[] = [
  { key: "LIFE_MIN_CONFIDENCE", kind: "num", min: 0.5, max: 0.99, group: "Detections", label: "Lowest score sent", what: "Detections under it stay on the node. The readings count from 0.7, and nothing under 0.7 is sent anyway.", when: "post" },
  { key: "LIFE_KEEP_CLIPS", kind: "enum", options: ["0", "1"], group: "Clips", label: "Keep clips", what: "0 keeps no clips at all and deletes those on the node.", when: "wake" },
  { key: "LIFE_CLIPS_ALL_FROM", kind: "num", min: 0.1, max: 1.01, group: "Clips", label: "Every clip from score", what: "Every clip from this score up is kept while the card has room; above 1 only the sample.", when: "run" },
  { key: "LIFE_CLIPS_PER_BAND", kind: "int", min: 0, max: 50, group: "Clips", label: "Sample per band", what: "Below that score, at most this many clips per species, month and band of 0.1.", when: "run" },
  { key: "LIFE_CLIPS_SECONDS", kind: "int", min: 3, max: 15, group: "Clips", label: "Clip length (s)", what: "Each kept clip is cut to this many seconds from the start of the detection.", when: "run" },
  { key: "LIFE_CLIPS_MIN_FREE_MB", kind: "int", min: 500, max: 20000, group: "Clips", label: "Room kept free (MB)", what: "With less free on the card only the sample still grows.", when: "run" },
  { key: "LIFE_CLIPS_KEEP_DAYS", kind: "int", min: 30, max: 730, group: "Clips", label: "Clips wait (days)", what: "A clip that never left the node is deleted after this.", when: "run" },
  { key: "LIFE_BIRD_MIC", kind: "enum", options: ["audiomoth", "i2s", "both"], group: "Microphones", label: "Birds on", what: "Which microphone hears the birds; both compares the two (the AudioMoth's birds then go out as test).", when: "wake" },
  { key: "LIFE_MIC_CHECK", kind: "enum", options: ["0", "1"], group: "Microphones", label: "Weekly check", what: "1: the I2S microphone listens beside the AudioMoth on the check day and their levels are compared.", when: "wake" },
  { key: "LIFE_MIC_CHECK_DAY", kind: "enum", options: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], group: "Microphones", label: "Check day", what: "The day of the week of that check.", when: "wake" },
  { key: "LIFE_BATS", kind: "enum", options: ["0", "1"], group: "Microphones", label: "Bats", what: "0 takes the bat model out of the evening.", when: "wake" },
  { key: "BAT_LEAD_MIN", kind: "int", min: 0, max: 120, group: "Microphones", label: "Bats from (min before sunset)", what: "The bat model starts this long before sunset.", when: "wake" },
  { key: "LIFE_BATS_BATTERY", kind: "enum", options: ["0", "1"], group: "Microphones", label: "Bats wait for the battery", what: "1: with less than the minimum below as the bat hours begin, the bat model stays out that evening, so the next dawn keeps its energy. A node on a 5 V supply keeps its bats.", when: "wake" },
  { key: "LIFE_BATS_MIN_V", kind: "num", min: 12.6, max: 13.6, group: "Microphones", label: "Bats from battery (V)", what: "The Witty Pi's reading, the battery less a few tenths. 13.1 V is about a third full on a LiFePO4 battery at rest.", when: "wake" },
  { key: "LIFE_BATS_MAX_C", kind: "num", min: 70, max: 84, group: "Microphones", label: "Bats out from processor (°C)", what: "The bat model goes out at this processor temperature and comes back 8 °C cooler, after at least a quarter of an hour. The Pi slows itself from 80 °C.", when: "wake" },
  { key: "VISIT_MAX_MIN", kind: "int", min: 5, max: 60, group: "Visits", label: "A visit lasts (min)", what: "After this the node's WiFi closes and a node the magnet woke sleeps again.", when: "visit" },
  { key: "VISIT_HOTSPOT_WAIT_S", kind: "int", min: 30, max: 600, group: "Visits", label: "Looks for the hotspot (s)", what: "How long a visit looks for the phone's hotspot before it opens the node's own WiFi.", when: "visit" },
  { key: "OFFWINDOW_GRACE_MIN", kind: "int", min: 3, max: 60, group: "Power", label: "Awake outside a window (min)", what: "A node its scheduler woke outside its windows posts and sleeps again after this.", when: "wake" },
  { key: "WITTYPI_LOW_V", kind: "num", min: 11.8, max: 13.0, group: "Power", label: "Battery guard stops at (V)", what: "Below this the node shuts itself down cleanly. Never off from here, and refused by a node on a mains adapter or one whose input is under it now.", when: "now" },
  { key: "WITTYPI_RECOVERY_V", kind: "num", min: 12.8, max: 13.6, group: "Power", label: "Starts again above (V)", what: "After such a stop the node starts again above this, which means the panel is charging. At least 0.3 V above the stop.", when: "now" },
];
const BY_KEY = new Map(NODE_SETTINGS.map((s) => [s.key, s]));
export const WHEN_TEXT: Record<NodeSetting["when"], string> = { post: "from its next post", run: "within a quarter of an hour", visit: "from the next visit", wake: "from its next wake", now: "as soon as it has them" };

/** The value as the node writes it, or an error: a number within the bounds, or one of the words. */
export function normalSetting(key: string, v: unknown): { ok: true; value: string } | { ok: false; why: string } {
  const s = BY_KEY.get(key);
  if (!s) return { ok: false, why: `${key} cannot be set over the air` };
  if (typeof v !== "string" && typeof v !== "number") return { ok: false, why: `${s.label}: not a value` };
  if (s.kind === "enum") {
    const w = String(v).trim().toLowerCase();
    return s.options.includes(w) ? { ok: true, value: w } : { ok: false, why: `${s.label}: one of ${s.options.join(", ")}` };
  }
  const x = typeof v === "number" ? v : Number(String(v).trim());
  if (String(v).trim() === "" || !Number.isFinite(x) || x < s.min || x > s.max) return { ok: false, why: `${s.label}: from ${s.min} to ${s.max}` };
  if (s.kind === "int") return Number.isInteger(x) ? { ok: true, value: String(x) } : { ok: false, why: `${s.label}: a whole number` };
  return { ok: true, value: String(Math.round(x * 1000) / 1000) };
}

export const MAX_RULES = 8;
const MAX_DAY_MIN = 16 * 60;

/** Why a node would refuse these rules, as node/image/life-schedule-wpi.py parse_rules says it, or null. */
export function rulesProblem(rules: WindowRule[]): string | null {
  if (rules.length < 1 || rules.length > MAX_RULES) return `the windows are 1 to ${MAX_RULES} rules`;
  const names = rules.map((r) => r.name);
  if (new Set(names).size !== names.length) return "two windows have the same name";
  for (let m = 1; m <= 12; m++) {
    const total = rules.filter((r) => monthsOf(r.months)?.has(m)).reduce((s, r) => s + r.min, 0);
    if (total === 0) return `no window in month ${m}: the node would not wake`;
    if (total > MAX_DAY_MIN) return `month ${m} would hold ${total / 60} h of windows, more than ${MAX_DAY_MIN / 60}`;
  }
  return null;
}

type Stored = { env: Record<string, string> };

function stored(c: unknown): Stored {
  const o = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
  const env = o.env && typeof o.env === "object" && !Array.isArray(o.env) ? (o.env as Record<string, string>) : {};
  return { env };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export type ConfigOut = { rev: string; windows: WindowRule[]; env: Record<string, string> };
type ConfigRow = { config: unknown; configN: number };

/** What the node should run: the method's windows, its settings, and their rev. The rev changes with every save
 * (configN), so the same settings can be sent again after a node refused them, and with every new version of the
 * method's windows, so that reaches every node. */
export function effectiveConfig(d: ConfigRow): ConfigOut {
  const s = stored(d.config);
  const windows: WindowRule[] = METHOD_RULES.map((r) => ({ ...r }));
  const env = Object.fromEntries(Object.entries(s.env).sort(([a], [b]) => a.localeCompare(b)));
  const rev = createHash("sha256").update(canonical({ n: d.configN, windows, env })).digest("hex").slice(0, 8);
  return { rev, windows, env };
}

/** The settings for the heartbeat answer: only to a node that runs life-config (it reports a cfgRev), only when its rev
 * is not the current one, and not again when it refused this very rev (it says why; a new save sends them again). */
export function configFor(d: ConfigRow, metrics: Record<string, unknown> | undefined): ConfigOut | undefined {
  const nodeRev = metrics?.cfgRev;
  if (typeof nodeRev !== "string") return undefined;
  const c = effectiveConfig(d);
  if (nodeRev === c.rev || metrics?.cfgRefused === c.rev) return undefined;
  return c;
}

/** PUT body: env sets a setting, null gives it back to the node; again: true sends the same settings once more under a
 * new rev (after a node refused them). */
export const ConfigBody = z.object({
  env: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  again: z.boolean().optional(),
});

/** The stored settings after a PUT, or why not. The node checks them again; this is so the owner hears it now. */
export function nextConfig(current: unknown, body: z.infer<typeof ConfigBody>): { ok: true; config: Stored } | { ok: false; why: string } {
  const s = stored(current);
  const env = { ...s.env };
  for (const [k, v] of Object.entries(body.env ?? {})) {
    if (v === null) { delete env[k]; continue; }
    const n = normalSetting(k, v);
    if (!n.ok) return { ok: false, why: n.why };
    env[k] = n.value;
  }
  if (env.WITTYPI_LOW_V !== undefined || env.WITTYPI_RECOVERY_V !== undefined) {
    const low = Number(env.WITTYPI_LOW_V ?? 12.6), rec = Number(env.WITTYPI_RECOVERY_V ?? 13.2);
    if (rec < low + 0.3 - 1e-9) return { ok: false, why: `the battery guard starts again at ${rec} V, which must be at least 0.3 V above its stop at ${low} V` };
  }
  return { ok: true, config: { env } };
}

type LastSettings = { ts: Date; settings: Record<string, unknown> };

/** What the owner sees: the method's windows with today's times at the place, the settings, and whether the node has
 * them, as its last heartbeat said. */
export async function configState(deviceId: string) {
  const d = await prisma.device.findUniqueOrThrow({
    where: { id: deviceId },
    select: { config: true, configN: true, configAt: true, configBy: true, place: { select: { centroidLat: true, centroidLon: true } } },
  });
  const [hb, last] = await Promise.all([
    prisma.heartbeat.findFirst({ where: { deviceId }, orderBy: { ts: "desc" }, select: { ts: true, metrics: true } }),
    prisma.$queryRaw<LastSettings[]>`select "ts", "metrics"->'settings' as settings from "Heartbeat"
      where "deviceId" = ${deviceId} and jsonb_typeof("metrics"->'settings') = 'object' order by "ts" desc limit 1`,
  ]);
  const m = (hb?.metrics ?? {}) as Record<string, unknown>;
  const c = effectiveConfig(d);
  const s = stored(d.config);
  const nodeRev = typeof m.cfgRev === "string" ? m.cfgRev : null;
  const refused = typeof m.cfgRefused === "string" && m.cfgRefused ? { rev: m.cfgRefused, why: typeof m.cfgWhy === "string" ? m.cfgWhy : null } : null;
  const today = ruleWindows(Date.now(), d.place.centroidLat, d.place.centroidLon, c.windows).map((w) => ({ name: w.name, start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }));
  return {
    device: deviceId, rev: c.rev, method: METHOD_RULES, env: s.env, today,
    nodeRev, capable: nodeRev !== null, nodeHas: nodeRev === c.rev, trial: m.cfgTrial === true && nodeRev === c.rev,
    refused: refused && refused.rev === c.rev ? refused : null,
    ignored: typeof m.cfgIgnored === "string" && m.cfgIgnored ? m.cfgIgnored.split(",") : [],
    running: last[0] ? { at: last[0].ts.toISOString(), settings: Object.fromEntries(Object.entries(last[0].settings).filter(([, v]) => typeof v === "string")) as Record<string, string> } : null,
    heardAt: hb?.ts.toISOString() ?? null, savedAt: d.configAt?.toISOString() ?? null, savedBy: d.configBy,
    settings: NODE_SETTINGS,
  };
}

export type ConfigState = Awaited<ReturnType<typeof configState>>;
