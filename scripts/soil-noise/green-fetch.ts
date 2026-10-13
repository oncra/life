/**
 * Sentinel-2 greenness at each Twente station, March to October 2018-2020 (Earth Search has L2A here from 2018), through
 * the oracle's own satellite path (src/lib/satellite.ts, the same NDVI a place gets): an 80 m square around the station,
 * one value per clear scene.
 * Used by green.ts to test the water loop per unit of green (content/soil-water.md).
 *   npx tsx scripts/soil-noise/green-fetch.ts ~/scratch/twente      # writes DATA/ndvi/<station>.json, resumable
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ndviForScene, searchScenes } from "../../src/lib/satellite";

const DATA = process.argv[2] ?? `${process.env.HOME}/scratch/twente`;
const meta = JSON.parse(readFileSync(new URL("./stations.json", import.meta.url), "utf8")) as { stations: Record<string, { lat: number; lon: number }> };
mkdirSync(join(DATA, "ndvi"), { recursive: true });
const CONC = Number(process.env.CONC ?? 6);

function square(lat: number, lon: number, halfM = 40) {
  const dLat = halfM / 111_320, dLon = halfM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { type: "Polygon" as const, coordinates: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]] };
}

async function main() {
  // SHARD=k/n: several processes can share the stations
  const [k, n] = (process.env.SHARD ?? "0/1").split("/").map(Number);
  const list = Object.entries(meta.stations).filter((_, i) => i % n === k);
  for (const [name, s] of list) {
    const out = join(DATA, "ndvi", `${name}.json`);
    if (existsSync(out)) { console.log(name, "done before"); continue; }
    const geom = square(s.lat, s.lon);
    const items: Awaited<ReturnType<typeof searchScenes>> = [];
    const found = [];
    for (let y = 2018; y <= 2020; y++) found.push(...(await searchScenes(geom, `${y}-03-01`, `${y}-10-31`)));
    // where two tiles cover the station, one scene per day is enough: the one with the fewest clouds
    const byDay = new Map<string, (typeof found)[number]>();
    for (const it of found) {
      const day = it.properties.datetime.slice(0, 10), cur = byDay.get(day);
      if (!cur || (it.properties["eo:cloud_cover"] ?? 100) < (cur.properties["eo:cloud_cover"] ?? 100)) byDay.set(day, it);
    }
    items.push(...byDay.values());
    const rows: { date: string; ndvi: number; valid: number; scene: string }[] = [];
    let failed = 0;
    for (let i = 0; i < items.length; i += CONC) {
      const batch = items.slice(i, i + CONC);
      const res = await Promise.allSettled(batch.map((it) => ndviForScene(it, geom, 0.6)));
      res.forEach((r, k) => {
        if (r.status === "rejected") { failed++; return; }
        if (r.value) rows.push({ date: r.value.date, ndvi: Math.round(r.value.ndviMean * 1000) / 1000, valid: Math.round(r.value.validFraction * 100) / 100, scene: batch[k].id });
      });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    writeFileSync(out, JSON.stringify({ station: name, scenesSearched: items.length, failed, rows }));
    console.log(name, "scenes", items.length, "clear", rows.length, "failed", failed);
  }
}
main();
