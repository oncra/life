/** Checks for the meadow-bird window (src/lib/night.ts, src/lib/node-night.ts): npm run night:test. No database. */
import assert from "node:assert/strict";
import { clockLabel } from "../src/lib/clock";
import { coreWindows } from "../src/lib/listening";
import { inSeason, mdLabel, NIGHT_DEFAULTS, NIGHT_GAP_MS, nightLastOf, nightLastText, nightPlan, nightWindow, type NightSettings } from "../src/lib/night";
import { NightBody, nightFor } from "../src/lib/node-night";
import { sunAt } from "../src/lib/sun";

const LAT = 52.37, LON = 4.9;   // Amsterdam, as the dashboard reads Dutch places
const Z = "Europe/Amsterdam";
const MIN = 6e4;
const on: NightSettings = { ...NIGHT_DEFAULTS, on: true };
const noon = (d: string) => Date.parse(`${d}T10:30:00Z`);   // local midday in summer and winter time alike
const sunset = (d: string) => sunAt(Date.parse(`${d}T12:00:00Z`), LAT, LON, -0.833)!.set;
const lastCoreEnd = (d: string) => { const c = coreWindows(Date.parse(`${d}T12:00:00Z`), LAT, LON); return c[c.length - 1][1]; };
const firstCoreStart = (d: string) => coreWindows(Date.parse(`${d}T12:00:00Z`), LAT, LON)[0][0];
const ok = (b: unknown) => NightBody.safeParse(b).success;

// the PUT body: every field optional, each one checked
assert.ok(ok({}));
assert.ok(ok({ on: true, startMin: 60, lenMin: 60, from: "03-25", to: "06-30", battery: true, minV: 13.1 }));
assert.ok(ok({ from: "02-29", to: "12-31", startMin: 0, lenMin: 180, minV: 12 }));
for (const bad of [{ startMin: 361 }, { startMin: -5 }, { startMin: 30.5 }, { lenMin: 10 }, { lenMin: 181 }, { from: "02-30" }, { from: "13-01" },
  { to: "2-5" }, { to: "06-31" }, { minV: 13.15 }, { minV: 11.9 }, { minV: 14.1 }, { on: "yes" }, { battery: 1 }]) assert.ok(!ok(bad), JSON.stringify(bad));
assert.match(NightBody.safeParse({ minV: 13.15 }).error!.issues[0].message, /one decimal/);

// the season, both ends included, also over the new year
assert.ok(inSeason("03-25", "03-25", "06-30") && inSeason("06-30", "03-25", "06-30") && inSeason("05-01", "03-25", "06-30"));
assert.ok(!inSeason("03-24", "03-25", "06-30") && !inSeason("07-01", "03-25", "06-30"));
assert.ok(inSeason("12-01", "12-01", "02-28") && inSeason("01-15", "12-01", "02-28") && !inSeason("06-01", "12-01", "02-28"));
assert.equal(mdLabel("03-25"), "25 Mar");

// the heartbeat answer: only to a node that reports a rev, and only when it differs
const row = { nightOn: true, nightStartMin: 75, nightLenMin: 90, nightFrom: "04-01", nightTo: "06-15", nightBattery: false, nightMinV: 13.3, nightRev: 3 };
assert.equal(nightFor(row, undefined), undefined);
assert.equal(nightFor(row, "3"), undefined);
assert.equal(nightFor(row, 3), undefined);
assert.deepEqual(nightFor(row, 2), { rev: 3, on: true, startMin: 75, lenMin: 90, from: "04-01", to: "06-15", battery: false, minV: 13.3 });
assert.equal(nightFor({ ...row, nightRev: 0, nightOn: false }, -1)?.on, false);   // a node without settings gets them, off

// the default hour: straight after the dusk window, for an hour, on 1 May
const may = nightWindow(noon("2026-05-01"), LAT, LON, on, Z)!;
assert.equal(may[0], lastCoreEnd("2026-05-01"));
assert.equal(may[0], sunset("2026-05-01") + 60 * MIN);
assert.equal(may[1] - may[0], 60 * MIN);
// off, or out of season: none
assert.equal(nightWindow(noon("2026-05-01"), LAT, LON, NIGHT_DEFAULTS, Z), null);
assert.equal(nightWindow(noon("2026-03-24"), LAT, LON, on, Z), null);
assert.equal(nightWindow(noon("2026-07-01"), LAT, LON, on, Z), null);
assert.ok(nightWindow(noon("2026-03-25"), LAT, LON, on, Z) && nightWindow(noon("2026-06-30"), LAT, LON, on, Z));
// never inside the dusk window: a start in it moves to its end, the end stays
const half = nightWindow(noon("2026-05-01"), LAT, LON, { ...on, startMin: 30 }, Z)!;
assert.deepEqual(half, [sunset("2026-05-01") + 60 * MIN, sunset("2026-05-01") + 90 * MIN]);
assert.equal(nightWindow(noon("2026-05-01"), LAT, LON, { ...on, startMin: 0 }, Z), null);
// and never closer than 15 minutes to the next dawn, at midsummer with the latest start and the longest window
const mid = nightWindow(noon("2026-06-21"), LAT, LON, { ...on, startMin: 300, lenMin: 180 }, Z)!;
assert.equal(mid[1], firstCoreStart("2026-06-22") - NIGHT_GAP_MS);
assert.ok(mid[0] === sunset("2026-06-21") + 300 * MIN && mid[1] > mid[0]);
// across the change to summer time (29 March 2026): the same rule, an hour later on the clock
const label = (d: string) => clockLabel(nightWindow(noon(d), LAT, LON, on, Z)![0], Z);
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
assert.equal(label("2026-03-28").slice(0, 2), "20");
assert.equal(label("2026-03-29").slice(0, 2), "21");
const jump = mins(label("2026-03-29")) - mins(label("2026-03-28"));
assert.ok(jump >= 60 && jump <= 63, `the window moved ${jump} min on the clock`);
for (const d of ["2026-03-28", "2026-03-29", "2026-03-30"]) assert.equal(nightWindow(noon(d), LAT, LON, on, Z)![0], sunset(d) + 60 * MIN, d);
// a winter season, from the morning window to the evening
const dec = nightWindow(noon("2026-12-15"), LAT, LON, { ...on, from: "12-01", to: "02-28" }, Z)!;
assert.ok(dec[0] === sunset("2026-12-15") + 60 * MIN && dec[0] > lastCoreEnd("2026-12-15"));

// what the dashboard says ahead of it
const a = nightPlan(Date.parse("2026-05-01T12:00:00Z"), LAT, LON, on, Z);
assert.deepEqual(a.tonight, { start: new Date(may[0]).toISOString(), end: new Date(may[1]).toISOString() });
const after = nightPlan(may[1] + MIN, LAT, LON, on, Z);
assert.equal(after.tonight?.start, new Date(nightWindow(noon("2026-05-02"), LAT, LON, on, Z)![0]).toISOString());
assert.deepEqual(nightPlan(Date.parse("2026-11-02T12:00:00Z"), LAT, LON, on, Z), { tonight: null, seasonFrom: "2027-03-25", fits: true });
const lastOfSeason = nightWindow(noon("2026-06-30"), LAT, LON, on, Z)!;
assert.equal(nightPlan(lastOfSeason[1] + MIN, LAT, LON, on, Z).seasonFrom, "2027-03-25");
assert.deepEqual(nightPlan(Date.parse("2026-05-01T12:00:00Z"), LAT, LON, { ...on, startMin: 0 }, Z), { tonight: null, seasonFrom: null, fits: false });
assert.deepEqual(nightPlan(Date.parse("2026-05-01T12:00:00Z"), LAT, LON, NIGHT_DEFAULTS, Z), { tonight: null, seasonFrom: null, fits: true });

// how the last one went, read defensively from the heartbeat
const last = { date: "2026-05-01", start: "2026-05-01T19:47:00Z", end: "2026-05-01T20:47:00Z", ran: "listened", v: 13.24, minV: 13.1, at: "2026-05-01T19:47:05Z" };
assert.deepEqual(nightLastOf(last), last);
for (const bad of [null, [], "x", { ...last, at: "never" }, { ...last, ran: 3 }]) assert.equal(nightLastOf(bad), null);
assert.deepEqual(nightLastOf({ ...last, v: "13.2", date: "1 May" }), { ...last, v: null, date: null });
assert.equal(nightLastText(nightLastOf(last)!, Z), "Fri 1 May: listened 21:47 to 22:47, battery 13.24 V");
assert.equal(nightLastText(nightLastOf({ ...last, ran: "battery", v: 12.9 })!, Z), "Fri 1 May: skipped for the battery: 12.9 V under 13.1 V");
assert.equal(nightLastText(nightLastOf({ ...last, ran: "unknown", v: null })!, Z), "Fri 1 May: listened 21:47 to 22:47; the battery could not be read");
assert.equal(nightLastText(nightLastOf({ ...last, ran: "kept", v: 12.7 })!, Z), "Fri 1 May: the alarm was silenced, so it stayed on (21:47 to 22:47)");
console.log("night: all checks pass");
