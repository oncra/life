/** Checks for the node's status panel (src/lib/node-status.ts): npm run status:test. No database. */
import assert from "node:assert/strict";
import { bars, liveOf, statusFrom, throttleOf, type LiveRow, type StatusBeat, type StatusInput } from "../src/lib/node-status";
import { METHOD_RULES, ruleWindows } from "../src/lib/listening";

const LAT = 52.38, LON = 4.92, ZONE = "Europe/Amsterdam";
const H = 3600e3;
const now = Date.parse("2026-11-09T22:10:00Z");
const base = (over: Partial<StatusInput> = {}): StatusInput => ({
  now, lat: LAT, lon: LON, zone: ZONE, beats: [], live: null, liveEver: false, seenAt: null, night: null,
  sound: { today: 0, week: 0, detectionsToday: 0, last: null, perHour: Array(24).fill(0) }, soil: [], ...over,
});
const beat = (t: number, event: string, metrics: Record<string, unknown> = {}, cell: Record<string, unknown> | null = null): StatusBeat => ({ t, event, cell, metrics });

// nothing yet
assert.equal(statusFrom(base()).state, "never");

// node 1 on 9 November 2026: woken by the button for a visit at 17:47 UTC, nothing since
const visit = beat(Date.parse("2026-11-09T17:47:08Z"), "hourly", { wake: "button", window: null, offWindow: "visit", uptimeS: 24, vinV: 4.67, piW: 3.95, cpuTempC: 17.5, boxTempC: 4.5, throttled: "0x0", diskFreeMb: 50324, unsent: 0 });
let s = statusFrom(base({ beats: [visit] }));
assert.equal(s.state, "quiet", "more than four hours without a post");
assert.equal(s.source, "post");
assert.deepEqual(s.power, { v: 4.67, src: "usb", piW: 3.95, pvW: null, charge: null, yieldWh: null });
assert.equal(s.upSince, null, "no uptime for a node that has gone quiet");
const [nextWinter] = ruleWindows(Date.parse("2026-11-10T12:00:00Z"), LAT, LON, METHOD_RULES, ZONE);
assert.deepEqual(s.next, { kind: "wake", at: nextWinter.start, name: "winter" }, "the wake it has if it is asleep");
// an hour after that post it was awake for the visit, the next post three hours after it
s = statusFrom(base({ beats: [visit], now: visit.t + H }));
assert.equal(s.state, "awake");
assert.equal(s.offWindow, "visit");
assert.deepEqual(s.next, { kind: "post", at: visit.t + 3 * H, name: null });
assert.equal(s.upSince, visit.t - 24e3);

// that morning: woken by its alarm for the winter window, posting from inside it over 4G
const [winter] = ruleWindows(Date.parse("2026-11-09T12:00:00Z"), LAT, LON, METHOD_RULES, ZONE);
assert.equal(winter.name, "winter");
const dawnPost = beat(Date.parse("2026-11-09T06:50:22Z"), "hourly", { window: "winter", wake: "alarm", uptimeS: 185, vinV: 4.73 }, { plmn: "20416", rsrp: -101, rssi: -75, cellId: "123456", tac: "77" });
s = statusFrom(base({ beats: [dawnPost], now: Date.parse("2026-11-09T07:00:00Z") }));
assert.equal(s.state, "listening");
assert.deepEqual(s.window, { name: "winter", start: winter.start, end: winter.end });
assert.deepEqual(s.next, { kind: "sleep", at: winter.end, name: "winter" }, "the window ends before the next post in the rhythm");
assert.equal(s.link.operator, "Odido (T-Mobile NL)");
assert.equal(s.link.bars, 1);
assert.ok(!JSON.stringify(s).includes("123456") && !JSON.stringify(s).includes("cellId"), "never the cell id");

// asleep after the window, waking for tomorrow's
const shutdown = beat(Date.parse("2026-11-09T08:13:22Z"), "shutdown", { window: "winter", wake: "alarm", vinV: 4.73 });
s = statusFrom(base({ beats: [dawnPost, shutdown] }));
assert.equal(s.state, "asleep");
const [tomorrow] = ruleWindows(Date.parse("2026-11-10T12:00:00Z"), LAT, LON, METHOD_RULES, ZONE);
assert.deepEqual(s.next, { kind: "wake", at: tomorrow.start, name: "winter" });
assert.equal(s.upSince, null);
// the shutdown post asks the stick nothing: the signal is the dawn post's, and says when it was read
assert.deepEqual([s.link.operator, s.link.rsrp, s.link.at], ["Odido (T-Mobile NL)", -101, dawnPost.t]);
// the throttle flags only when the node sent them
assert.deepEqual(statusFrom(base({ beats: [visit] })).heat.throttle, { slowedNow: false, slowedSinceBoot: false, lowVoltage: false });
assert.equal(s.heat.throttle, null);
// the owner's meadow-bird window, when it comes first
s = statusFrom(base({ beats: [dawnPost, shutdown], night: [now + H, now + 2 * H] }));
assert.deepEqual(s.next, { kind: "wake", at: now + H, name: "night" });
// in the meadow-bird window, which the node calls "night": its times are the owner's window
const night: [number, number] = [now - H, now + 2 * H];
s = statusFrom(base({ beats: [beat(now - 20 * 6e4, "hourly", { window: "night", wake: "alarm", uptimeS: 2400 })], night }));
assert.equal(s.state, "listening");
assert.deepEqual(s.window, { name: "night", start: night[0], end: night[1] });
assert.deepEqual(s.next, { kind: "sleep", at: night[1], name: "night" }, "the window ends before the next post in the rhythm");
// a window of the owner's own that the method does not know: the node's word counts, without times
s = statusFrom(base({ beats: [beat(now - 20 * 6e4, "hourly", { window: "survey" })] }));
assert.deepEqual([s.state, s.window], ["listening", { name: "survey", start: null, end: null }]);
// the window ended an hour ago and the post it sends before it sleeps never came: a post is missing
s = statusFrom(base({ beats: [dawnPost], now: winter.end + H }));
assert.deepEqual([s.state, s.window?.end], ["quiet", winter.end]);
// the battery guard's stop is not sleep: it starts again with the sun, not at a time
s = statusFrom(base({ beats: [beat(now - 2 * H, "shutdown", { wake: "low-voltage", vinV: 12.55 })] }));
assert.equal(s.state, "saving");
assert.equal(s.next, null);
assert.deepEqual([s.power.v, s.power.src], [12.55, "wittypi"]);
// the charge controller's battery wins over the Witty Pi's input
s = statusFrom(base({ beats: [beat(now - H, "hourly", { battV: 13.31, vinV: 13.1, pvW: 21, charge: "bulk", yieldTodayWh: 140 })] }));
assert.deepEqual(s.power, { v: 13.31, src: "mppt", piW: null, pvW: 21, charge: "bulk", yieldWh: 140 });
// silent after 36 hours
assert.equal(statusFrom(base({ beats: [beat(now - 40 * H, "hourly")] })).state, "silent");
// a station that sends detections and no heartbeats
assert.equal(statusFrom(base({ seenAt: now - H })).state, "on");
assert.equal(statusFrom(base({ seenAt: now - 10 * H })).state, "quiet");

// live on WiFi: the latest post and the last minutes for the lines
const liveRow: LiveRow = {
  at: now - 15e3, net: { via: "wifi", dBm: -61 }, metrics: { window: null, offWindow: "visit", uptimeS: 600, piW: 4.2, cpuTempC: 48, vinV: 5.1 },
  cell: { plmn: "20416", rsrp: -95 }, hist: [[now - 35e3, 4.1, 47, 5.1, -96], [now - 15e3, 4.2, 48, 5.1, -95]],
};
s = statusFrom(base({ beats: [visit], live: liveRow, liveEver: true }));
assert.equal(s.state, "live");
assert.equal(s.source, "live");
assert.equal(s.via, "wifi");
assert.equal(s.link.wifiDbm, -61);
assert.equal(s.link.bars, 2, "the 4G stick's signal, also while it posts over WiFi");
assert.equal(s.spark.span, "live");
assert.deepEqual(s.spark.piW, [[now - 35e3, 4.1], [now - 15e3, 4.2]]);
assert.equal(s.upSince, now - 15e3 - 600e3);
assert.equal(s.liveEver, true);
// a live post older than LIVE_FRESH_S is not live: back to the last heartbeat
s = statusFrom(base({ beats: [visit], live: { ...liveRow, at: now - 100e3 }, liveEver: true }));
assert.equal(s.source, "post");
assert.equal(s.state, "quiet");
// live inside a window: it will sleep at the window's end
s = statusFrom(base({ beats: [dawnPost], live: { ...liveRow, at: Date.parse("2026-11-09T07:00:00Z") - 5e3, metrics: { window: "winter" } }, now: Date.parse("2026-11-09T07:00:00Z") }));
assert.deepEqual([s.state, s.next?.kind, s.next?.at], ["live", "sleep", winter.end]);
// what the device keeps, read back
assert.deepEqual(liveOf(JSON.parse(JSON.stringify(liveRow))), liveRow);
assert.equal(liveOf(null), null);
assert.equal(liveOf({ net: {} }), null);

// the lines from the posts when not live
s = statusFrom(base({ beats: [dawnPost, shutdown] }));
assert.equal(s.spark.span, "posts");
assert.deepEqual(s.spark.rsrp, [[dawnPost.t, -101]]);
assert.deepEqual(s.spark.v, [[dawnPost.t, 4.73], [shutdown.t, 4.73]]);

// soil: the last reading of each probe heard in the past two days, the shallow probe's line
s = statusFrom(base({ soil: [{ depthCm: 10, rows: [{ t: now - 3 * H, vwc: 22.5, tempC: 8 }, { t: now - H, vwc: 23, tempC: 8.2 }] }, { depthCm: 30, rows: [{ t: now - 3 * 864e5, vwc: 30, tempC: 10 }] }] }));
assert.deepEqual(s.soil, [{ depthCm: 10, vwc: 23, tempC: 8.2, t: now - H }], "a probe silent for two days drops out");
assert.deepEqual(s.spark.vwc, [[now - 3 * H, 22.5], [now - H, 23]]);

// signal bars and the Pi's throttle flags
assert.deepEqual([-75, -85, -95, -105, -115].map((r) => bars(r, null)), [4, 3, 2, 1, 0]);
assert.equal(bars(null, -70), 3);
assert.equal(bars(null, null), null);
assert.deepEqual(throttleOf("0x0"), { slowedNow: false, slowedSinceBoot: false, lowVoltage: false });
assert.deepEqual(throttleOf("0x50005"), { slowedNow: true, slowedSinceBoot: true, lowVoltage: true });
assert.deepEqual(throttleOf("0x20000"), { slowedNow: false, slowedSinceBoot: true, lowVoltage: false });
assert.equal(throttleOf("hot"), null);

console.log("status: ok");
