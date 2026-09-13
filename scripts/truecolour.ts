/**
 * True-colour Sentinel-2 crop around a registered place, with the boundary drawn.
 * Reads B04/B03/B02 windows straight from the same public COGs the NDVI stream uses.
 * Usage: npx tsx scripts/truecolour.ts <slug> <from> <to> <halfWidthMetres> <out.png>
 */
import { fromUrl } from "geotiff";
import proj4 from "proj4";
import sharp from "sharp";
import { searchScenes, type StacItem } from "../src/lib/satellite";
import { polygons, type PlaceGeometry } from "../src/lib/geo";

async function main() {
const [slug, from, to, halfStr, out] = process.argv.slice(2);
const half = Number(halfStr);

function utmDef(epsg: number) {
  const zone = epsg % 100, south = Math.floor(epsg / 100) === 327;
  return `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
}
function epsgOf(item: StacItem, asset?: { "proj:epsg"?: number; "proj:code"?: string }) {
  const code = asset?.["proj:code"] ?? item.properties["proj:code"];
  if (typeof code === "string" && code.startsWith("EPSG:")) return Number(code.slice(5));
  return (asset?.["proj:epsg"] ?? item.properties["proj:epsg"]) as number;
}

const res = await fetch(`https://life.oncra.org/api/v1/places/${slug}`);
const { place } = (await res.json()) as { place: { geometry: PlaceGeometry; centroidLat: number; centroidLon: number; name: string } };
const geom = place.geometry;

const scenes = await searchScenes(geom, from, to, 5, 200);
scenes.sort((a, b) => (a.properties["eo:cloud_cover"] ?? 100) - (b.properties["eo:cloud_cover"] ?? 100));
console.log(`${scenes.length} scenes under 5% cloud; using ${scenes[0]?.id} (${scenes[0]?.properties.datetime}, ${scenes[0]?.properties["eo:cloud_cover"]}%)`);
const item = scenes[0];
if (!item) throw new Error("no scene");

const epsg = epsgOf(item, item.assets.red);
const toUtm = proj4("EPSG:4326", utmDef(epsg));
const [cx, cy] = toUtm.forward([place.centroidLon, place.centroidLat]);
const bbox: [number, number, number, number] = [cx - half, cy - half, cx + half, cy + half];

const bands = await Promise.all(["red", "green", "blue"].map(async (b) => {
  const img = await (await fromUrl(item.assets[b].href)).getImage();
  const [ox, oy] = img.getOrigin(); const [rx, ry] = img.getResolution();
  const x0 = Math.floor((bbox[0] - ox) / rx), x1 = Math.ceil((bbox[2] - ox) / rx);
  const y0 = Math.floor((bbox[3] - oy) / ry), y1 = Math.ceil((bbox[1] - oy) / ry);
  const r = await img.readRasters({ window: [x0, y0, x1, y1] });
  return { data: r[0] as unknown as ArrayLike<number>, w: x1 - x0, h: y1 - y0, ox, oy, rx, ry, x0, y0 };
}));

const { w, h } = bands[0];
console.log(`window ${w}x${h} px at 10 m`);

// natural true colour: reflectance, soft shoulder, mild gamma. No per-band percentile
// stretch: that clips bright bare soil to white and dark fields to black, which reads as
// posterised rather than as a photograph of land.
function offsetOf(d: ArrayLike<number>) {
  const a: number[] = []; for (let i = 0; i < d.length; i++) if (d[i] > 0) a.push(d[i]);
  a.sort((x, y) => x - y);
  return a.length > 20 && a[Math.floor(a.length * 0.01)] >= 900 ? 1000 : 0;
}
const off = offsetOf(bands[0].data);
const MAX = 0.34; // reflectance mapped to white
const rgb = Buffer.alloc(w * h * 3);
for (let i = 0; i < w * h; i++) {
  for (let c = 0; c < 3; c++) {
    const refl = (bands[c].data[i] - off) / 10000;
    let v = Math.max(0, refl) / MAX;
    v = v / (1 + v * 0.35);            // soft shoulder: keeps bright soil off pure white
    v = Math.pow(Math.min(1, v), 1 / 1.5); // open up the midtones
    rgb[i * 3 + c] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
}

// boundary outline in the accent colour, 2 px
const b0 = bands[0];
const px = (x: number, y: number) => [Math.round((x - b0.ox) / b0.rx) - b0.x0, Math.round((y - b0.oy) / b0.ry) - b0.y0];
const rings = polygons(geom).map((poly) => poly.map((ring) => ring.map(([lon, lat]) => toUtm.forward([lon, lat]))));
const set = (x: number, y: number) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const i = (yy * w + xx) * 3;
    rgb[i] = 255; rgb[i + 1] = 255; rgb[i + 2] = 255;
  }
};
for (const poly of rings) for (const ring of poly) {
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = px(ring[i][0], ring[i][1]);
    const [bx, by] = px(ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]);
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let s = 0; s <= steps; s++) set(Math.round(ax + ((bx - ax) * s) / steps), Math.round(ay + ((by - ay) * s) / steps));
  }
}

await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
  .resize({ width: 1600, kernel: "lanczos3" })
  .modulate({ saturation: 1.06 })
  .png()
  .toFile(out);
console.log("wrote", out, "scene", item.id, item.properties.datetime);
}
main();
