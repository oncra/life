// Checks for the settings over the air (src/lib/node-config.ts, METHOD_RULES and ruleWindows in src/lib/listening.ts).
// Run: npm run config:test. No database: the functions under test are pure.
//
// 1. METHOD_RULES, read as the nodes read them, give exactly the windows the readings count (coreWindows), on every UTC
//    day of two years from 55 S to 70 N. What a node is told and what the oracle counts cannot drift apart.
// 2. The settings and the method's rules are the same on both sides: NODE_SETTINGS against SETTINGS in
//    node/life-config.py, METHOD_RULES against METHOD in node/image/life-schedule-wpi.py.
// 3. Values, rules, saves, revs and the heartbeat answer behave as documented.
import { readFileSync } from "node:fs";
import { coreWindows, METHOD_RULES, ruleWindows, type WindowRule } from "../src/lib/listening";
import { configFor, effectiveConfig, nextConfig, normalSetting, NODE_SETTINGS, rulesProblem } from "../src/lib/node-config";

let failed = 0, passed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else { failed++; console.error(`FAIL ${what}`, detail ?? ""); }
}

// 1
let days = 0;
for (let lat = -55; lat <= 70; lat += 5) {
  for (const lon of [-70, 0, 5, 150]) {
    for (let d = Date.UTC(2026, 0, 1); d < Date.UTC(2028, 0, 1); d += 864e5) {
      const a = coreWindows(d, lat, lon);
      const b = ruleWindows(d, lat, lon, METHOD_RULES);
      days++;
      const same = a.length === b.length && a.every(([s, e], i) => s === b[i].start && e === b[i].end);
      if (!same) { check(`method rules at ${lat},${lon} on ${new Date(d).toISOString().slice(0, 10)}`, false, { core: a, rules: b }); if (failed > 5) process.exit(1); }
    }
  }
}
check(`method rules give coreWindows on ${days} days`, true);

// 2
const py = readFileSync("node/life-config.py", "utf8");
const pySettings = new Map<string, string>();
for (const m of py.matchAll(/^\s+"([A-Z_]+)": (num|whole|one_of)\(([^)]*)\),/gm)) pySettings.set(m[1], `${m[2]}(${m[3].replace(/\s/g, "")})`);
const tsSettings = new Map(NODE_SETTINGS.map((s) => [s.key, s.kind === "enum" ? `one_of(${s.options.map((o) => `"${o}"`).join(",")})` : `${s.kind === "int" ? "whole" : "num"}(${s.kind === "num" && Number.isInteger(s.min) ? `${s.min}.0` : s.min},${s.kind === "num" && Number.isInteger(s.max) ? `${s.max}.0` : s.max})`]));
check("node/life-config.py lists the same settings", [...pySettings.keys()].sort().join() === [...tsSettings.keys()].sort().join(), { py: [...pySettings.keys()], ts: [...tsSettings.keys()] });
for (const [k, v] of tsSettings) {
  const p = pySettings.get(k)?.replace(/(\d)\.0(?=[,)])/g, "$1").replace(/^whole\(/, "whole(");
  const t = v.replace(/(\d)\.0(?=[,)])/g, "$1");
  check(`${k}: the same bounds on both sides`, p === t, { py: pySettings.get(k), ts: v });
}
const wpi = readFileSync("node/image/life-schedule-wpi.py", "utf8");
const block = /^METHOD = \[\n([\s\S]*?)\n\]/m.exec(wpi)?.[1] ?? "";
const pyMethod = block.split("\n").map((l) => JSON.parse(l.trim().replace(/,$/, "")));
check("node/image/life-schedule-wpi.py has the same method rules", JSON.stringify(pyMethod) === JSON.stringify(METHOD_RULES), { py: pyMethod });

// 3: values
const ok = (k: string, v: unknown, want: string) => { const n = normalSetting(k, v); check(`${k}=${String(v)} -> ${want}`, n.ok && n.value === want, n); };
const bad = (k: string, v: unknown) => check(`${k}=${String(v)} refused`, !normalSetting(k, v).ok);
ok("LIFE_CLIPS_ALL_FROM", 0.6, "0.6"); ok("LIFE_CLIPS_ALL_FROM", "0.60", "0.6"); ok("WITTYPI_LOW_V", 12.8, "12.8"); ok("WITTYPI_LOW_V", 13, "13");
ok("LIFE_CLIPS_SECONDS", "5", "5"); ok("LIFE_BIRD_MIC", "Both", "both"); ok("LIFE_BATS", 0, "0"); ok("LIFE_MIC_CHECK_DAY", "WED", "wed");
bad("LIFE_CLIPS_SECONDS", 2.5); bad("LIFE_CLIPS_SECONDS", 99); bad("WITTYPI_LOW_V", 0); bad("LIFE_MIN_CONFIDENCE", 0.2); bad("LIFE_BIRD_MIC", "usb");
bad("LIFE_DEVICE_TOKEN", "x"); bad("SCHEDULE", "none"); bad("LIFE_BATS", true); bad("LIFE_CLIPS_SECONDS", ""); bad("LIFE_CLIPS_SECONDS", Number.NaN);

// rules: the method's must pass the node's own checks (node/image/life-schedule-wpi.py parse_rules)
const more: WindowRule = { name: "night", months: "3-6", from: "dusk", offset: 60, min: 60 };
check("the method's rules are rules a node takes", rulesProblem(METHOD_RULES) === null);
check("a node needs a window every month", /month 1: the node would not wake/.test(rulesProblem([METHOD_RULES[0], METHOD_RULES[1]]) ?? ""));
check("16 hours a month at most", /more than 16/.test(rulesProblem([...METHOD_RULES, { name: "long", months: "6", from: "noon", min: 720 }]) ?? ""));
check("names are one each", /same name/.test(rulesProblem([...METHOD_RULES, { ...more, name: "dawn" }]) ?? ""));
check("eight rules at most", /1 to 8/.test(rulesProblem([...METHOD_RULES, ...Array.from({ length: 6 }, (_, i) => ({ ...more, name: `n${i}`, min: 15 }))]) ?? ""));

// saves
const saved = nextConfig(null, { env: { LIFE_CLIPS_ALL_FROM: 0.6, WITTYPI_LOW_V: "12.8" } });
check("a save keeps the settings, as the node writes them", saved.ok && saved.config.env.LIFE_CLIPS_ALL_FROM === "0.6" && saved.config.env.WITTYPI_LOW_V === "12.8", saved);
const cleared = saved.ok ? nextConfig(saved.config, { env: { LIFE_CLIPS_ALL_FROM: null } }) : null;
check("null gives a setting back to the node, the others stay", !!cleared?.ok && cleared.config.env.LIFE_CLIPS_ALL_FROM === undefined && cleared.config.env.WITTYPI_LOW_V === "12.8", cleared);
check("the guard starts again 0.3 V above its stop", !nextConfig(null, { env: { WITTYPI_LOW_V: 13, WITTYPI_RECOVERY_V: 13.2 } }).ok);
check("an unknown setting is refused", !nextConfig(null, { env: { LIFE_API: "https://x" } }).ok);

// revs and the answer
const row = { config: saved.ok ? saved.config : null, configN: 1 };
const e = effectiveConfig(row);
check("every node gets the method's windows", JSON.stringify(e.windows) === JSON.stringify(METHOD_RULES));
check("the rev is stable", effectiveConfig({ ...row }).rev === e.rev && /^[0-9a-f]{8}$/.test(e.rev));
check("a new save gives a new rev", effectiveConfig({ ...row, configN: 2 }).rev !== e.rev);
check("no settings, still the method's windows", effectiveConfig({ config: null, configN: 0 }).windows.length === 3);
check("a node without life-config is sent nothing", configFor(row, { visitRev: 2 }) === undefined && configFor(row, undefined) === undefined);
check("a node with these settings is sent nothing", configFor(row, { cfgRev: e.rev }) === undefined);
check("a node with others gets these", configFor(row, { cfgRev: "" })?.rev === e.rev && configFor(row, { cfgRev: "00000000" })?.env.WITTYPI_LOW_V === "12.8");
check("a node that refused these is not sent them again", configFor(row, { cfgRev: "", cfgRefused: e.rev }) === undefined);
check("the answer is small", JSON.stringify(configFor(row, { cfgRev: "" })).length < 600, JSON.stringify(configFor(row, { cfgRev: "" })).length);

// windows from rules (a future version of the method may use any of these)
const may = Date.UTC(2026, 4, 15);
const ws = ruleWindows(may, 52.3838, 4.9014, [...METHOD_RULES, more]);
check("a third window from civil dusk in May", ws.length === 3 && ws[2].name === "night" && ws[2].start > ws[1].end, ws);
const aug = ruleWindows(Date.UTC(2026, 7, 15), 52.3838, 4.9014, [...METHOD_RULES, more]);
check("not in August", aug.length === 2, aug);
const merged = ruleWindows(may, 52.3838, 4.9014, [...METHOD_RULES, { name: "early", months: "3-10", from: "dawn", offset: -60, min: 90 }]);
check("windows that overlap become one", merged[0].name === "early+dawn" && merged[0].end - merged[0].start === 5 * 36e5, merged[0]);
const clock = ruleWindows(Date.UTC(2026, 0, 10), 52.3838, 4.9014, [{ name: "c", months: "1-12", from: "clock", at: "13:30", min: 30 }]);
check("a clock window is local time", new Date(clock[0].start).toISOString() === "2026-01-10T12:30:00.000Z", clock);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
