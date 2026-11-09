/** Checks for the satellite season values (src/lib/readings.ts, content/spec.md 2.1 and 3.1): npm run readings:test. No database. */
import assert from "node:assert/strict";
import { clearDays, growingSeasonMeans, productivity, productivityBasis, seasonSpan, type SatPoint } from "../src/lib/readings";

const at = (iso: string) => new Date(`${iso}T10:56:00Z`);   // a Sentinel-2 pass over the Netherlands
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const LAT = 52.8, LON = 6.1;

// one observation per clear day: two tiles of one pass (one sees half the field) and a second product merge, weighted
const day = clearDays([
  { date: at("2026-06-20"), ndvi: 0.80, valid: 1 },
  { date: new Date("2026-06-20T10:56:04Z"), ndvi: 0.70, valid: 0.5 },
  { date: at("2026-06-23"), ndvi: 0.86, valid: 1 },
], LON);
assert.equal(day.length, 2);
near(day[0].ndvi, (0.80 * 1 + 0.70 * 0.5) / 1.5);
assert.equal(day[0].date.toISOString(), "2026-06-20T00:00:00.000Z");
assert.deepEqual(clearDays(day, LON), day, "merging again changes nothing");
assert.deepEqual(clearDays(day), day, "nor without the longitude");
// without a valid fraction every scene weighs the same
near(clearDays([{ date: at("2026-05-01"), ndvi: 0.5 }, { date: at("2026-05-01"), ndvi: 0.7 }])[0].ndvi, 0.6);
// the solar day: a pass at 23:30 UTC is the next day at 170 degrees east, the same day at 0 degrees
assert.equal(clearDays([{ date: new Date("2026-01-10T23:30:00Z"), ndvi: 0.3 }], 170)[0].date.toISOString().slice(0, 10), "2026-01-11");
assert.equal(clearDays([{ date: new Date("2026-01-10T23:30:00Z"), ndvi: 0.3 }], 0)[0].date.toISOString().slice(0, 10), "2026-01-10");

// season spans by hemisphere
assert.deepEqual(seasonSpan(LAT, 2026).map((t) => new Date(t).toISOString().slice(0, 10)), ["2026-04-01", "2026-09-30"]);
assert.deepEqual(seasonSpan(-33, 2026).map((t) => new Date(t).toISOString().slice(0, 10)), ["2025-10-01", "2026-03-31"]);

// the season value is the time-weighted mean: a level season stays level however unevenly it was seen
const level = (year: number, v: number, dates: string[]): SatPoint[] => dates.map((d) => ({ date: at(`${year}-${d}`), ndvi: v }));
near(growingSeasonMeans(level(2026, 0.75, ["04-02", "04-05", "04-09", "07-01"]), LAT)[0].mean, 0.75);
// a straight ramp from 1 April to 30 September, seen at both ends and once in between: the value is its middle
const ramp = (iso: string) => 0.5 + (0.3 * (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(2026, 3, 1))) / (Date.UTC(2026, 8, 30) - Date.UTC(2026, 3, 1));
near(growingSeasonMeans(["04-01", "06-12", "09-30"].map((d) => ({ date: at(`2026-${d}`), ndvi: ramp(`2026-${d}`) })), LAT)[0].mean, 0.65, 1e-9);
// flat before the first clear day and after the last
near(growingSeasonMeans([{ date: at("2026-05-01"), ndvi: 0.6 }, { date: at("2026-05-02"), ndvi: 0.6 }, { date: at("2026-08-01"), ndvi: 0.6 }, { date: at("2026-08-30"), ndvi: 0.6 }], LAT)[0].mean, 0.6);

// the case that made the change: a sunny April (low grass, many clear days) before a green summer seen once a month
const spring = (year: number, aprilDays: number): SatPoint[] => [
  ...Array.from({ length: aprilDays }, (_, i) => ({ date: at(`${year}-04-${String(3 + 2 * i).padStart(2, "0")}`), ndvi: 0.6 })),
  ...["05-15", "06-15", "07-15", "08-15", "09-15"].map((d) => ({ date: at(`${year}-${d}`), ndvi: 0.85 })),
];
const sunny = growingSeasonMeans(spring(2026, 8), LAT)[0], dull = growingSeasonMeans(spring(2025, 1), LAT)[0];
assert.equal(sunny.n, 13);
const plain = (8 * 0.6 + 5 * 0.85) / 13;
assert.ok(plain < 0.7 && sunny.mean > 0.79, `sunny April: plain ${plain.toFixed(3)}, season value ${sunny.mean.toFixed(3)}`);
assert.ok(Math.abs(sunny.mean - dull.mean) < 0.03, `the same land seen in a sunny and a dull April: ${sunny.mean.toFixed(3)} and ${dull.mean.toFixed(3)}`);
// and so the reading holds where the plain mean said falling
const history = [...spring(2022, 1), ...spring(2023, 2), ...spring(2024, 1), ...spring(2025, 8)];
const now = new Date("2026-03-01T12:00:00Z");
assert.equal(productivity(history, LAT, now).direction, "HOLDING");

// what the chart draws is what the reading compares
const b = productivityBasis([...history, ...spring(2026, 3)], LAT, new Date("2026-07-01T12:00:00Z"));
assert.deepEqual(b.complete.map((s) => s.year), [2022, 2023, 2024, 2025], "a season counts once it is over");
assert.equal(b.last?.year, 2025);
assert.deepEqual(b.prior.map((s) => s.year), [2022, 2023, 2024]);
near(b.ref!, [...b.prior.map((s) => s.mean)].sort((x, y) => x - y)[1]);
assert.equal(productivityBasis(history, LAT, new Date("2025-10-01T00:00:00Z")).last?.year, 2025, "complete from 1 October");
assert.equal(productivityBasis(history, LAT, new Date("2025-09-30T23:00:00Z")).last?.year, 2024);
// a season with fewer than four clear days is not counted
assert.deepEqual(productivityBasis(level(2026, 0.7, ["05-01", "06-01", "07-01"]), LAT, now).seasons, []);
// three complete seasons are needed
assert.equal(productivity([...spring(2023, 1), ...spring(2024, 1)], LAT, now).direction, "UNKNOWN");

console.log("readings: ok");
