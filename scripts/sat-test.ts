import { ndviForScene, searchScenes } from "../src/lib/satellite";
const geom = { type: "Polygon" as const, coordinates: [[[5.0500, 52.0500], [5.0560, 52.0500], [5.0560, 52.0535], [5.0500, 52.0535], [5.0500, 52.0500]]] };
async function main() {
const t0 = Date.now();
const items = await searchScenes(geom, "2026-05-01", "2026-09-12");
console.log("scenes", items.length, "in", Date.now() - t0, "ms");
for (const it of items.slice(-4)) {
  const t = Date.now();
  const r = await ndviForScene(it, geom).catch((e) => ({ error: String(e) }));
  console.log(it.id, JSON.stringify(r), Date.now() - t, "ms");
}
}
main();
