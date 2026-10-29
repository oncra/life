/** Checks for src/lib/mics.ts, the microphones' daily check: npm run mics:test */
import assert from "node:assert/strict";
import { byDay, micText, micVerdict, type MicDay } from "../src/lib/mics";

const bands = [250, 500, 1000, 2000, 4000, 8000, 12500];
const day = (d: string, diff: number[], n = 40, extra: Partial<MicDay> = {}): MicDay => ({ day: d, n, bands, diff, ...extra });
const usual = [30, 35.5, 34.6, 35.7, 37.5, 37, 36.3];  // node 1, AudioMoth minus I2S, 28-29 October 2026
const week = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d, k) =>
  day(d, usual.map((v) => v + (k % 2 ? 0.8 : -0.6))));
const moved = (by: Record<number, number>) => usual.map((v, k) => v + (by[bands[k]] ?? 0));

// a new node is learning until it has five days of at least ten readings
assert.deepEqual(micVerdict(week.slice(0, 4), day("2026-11-07", usual)), { state: "learning", days: 4 });
assert.equal(micVerdict(week, day("2026-11-07", usual, 6)).state, "learning");

// a healthy day: every bird band within 3 dB of the node's own median
assert.equal(micVerdict(week, day("2026-11-07", moved({ 2000: 2.1, 8000: -1.5 }))).state, "ok");

// the AudioMoth's port covered: it hears 9 dB less in three bird bands against the I2S microphone
const covered = micVerdict(week, day("2026-11-07", moved({ 2000: -9, 4000: -9.4, 8000: -8.6, 12500: -12 })));
assert.equal(covered.state, "drift");
if (covered.state === "drift") {
  assert.equal(covered.mic, "audiomoth");
  assert.deepEqual(covered.bands, [2000, 4000, 8000]);
  assert.equal(covered.db, 9.1);  // 9.1, 9.5 and 8.7 against a median 0.1 dB above the usual
}

// water behind the I2S microphone's membrane: the difference rises
const wet = micVerdict(week, day("2026-11-07", moved({ 1000: 7, 2000: 6.5 })));
assert.equal(wet.state === "drift" && wet.mic, "i2s");

// one band alone, or a move between 3 and 6 dB: watched, no alert and no all-clear
assert.equal(micVerdict(week, day("2026-11-07", moved({ 4000: -11 }))).state, "watch");
assert.equal(micVerdict(week, day("2026-11-07", moved({ 2000: -4, 4000: -4 }))).state, "watch");

// a microphone that gave no levels
assert.deepEqual(micVerdict(week, day("2026-11-07", usual, 0, { missing: ["i2s"] })), { state: "missing", mic: "i2s" });

// the same day sent more than once: the fullest stands, and today never judges itself
assert.equal(byDay([day("2026-11-01", usual, 4), day("2026-11-01", usual, 48), { nonsense: true }]).length, 1);
assert.equal(byDay([day("2026-11-01", usual, 4), day("2026-11-01", usual, 48)])[0].n, 48);
assert.equal(micVerdict([...week, day("2026-11-07", moved({ 2000: -9, 4000: -9 }))], day("2026-11-07", moved({ 2000: -9, 4000: -9 }))).state, "drift");

assert.match(micText({ state: "drift", mic: "audiomoth", db: 9, bands: [2000, 4000] }), /^the AudioMoth hears 9 dB less than usual next to the other microphone \(2 kHz, 4 kHz\)/);
assert.match(micText({ state: "missing", mic: "i2s" }), /^the I2S microphone gave no sound levels/);
console.log("mics: all checks pass");
