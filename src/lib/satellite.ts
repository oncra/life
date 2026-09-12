/**
 * Satellite stream: per-place NDVI from Sentinel-2 L2A cloud-optimised GeoTIFFs.
 *
 * Source: Earth Search STAC (Element 84) over the public `sentinel-cogs` bucket.
 * No account, no key. Each observation reads three small windows (red, nir, scl)
 * straight out of the COGs with HTTP range requests, masks clouds with the
 * Scene Classification Layer, and averages NDVI over the pixels inside the polygon.
 */
import { fromUrl, type GeoTIFFImage } from "geotiff";
import proj4 from "proj4";
import { pointInRings, polygons, type PlaceGeometry } from "./geo";
import * as turf from "@turf/turf";

export const STAC_URL = process.env.STAC_URL ?? "https://earth-search.aws.element84.com/v1";
export const STAC_COLLECTION = process.env.STAC_COLLECTION ?? "sentinel-2-l2a";

// SCL classes to keep: 4 vegetation, 5 not vegetated, 6 water, 7 unclassified, 11 snow (rare; excluded)
const KEEP_SCL = new Set([4, 5, 6, 7]);

export interface StacItem {
  id: string;
  properties: Record<string, unknown> & { datetime: string; "eo:cloud_cover"?: number; "proj:epsg"?: number; "proj:code"?: string };
  assets: Record<string, { href: string; "proj:epsg"?: number; "proj:code"?: string; "raster:bands"?: { scale?: number; offset?: number; nodata?: number }[] }>;
}

export async function searchScenes(geom: PlaceGeometry, from: string, to: string, maxCloud = 70, limit = 3000): Promise<StacItem[]> {
  const items: StacItem[] = [];
  let body: Record<string, unknown> = {
    collections: [STAC_COLLECTION],
    intersects: geom,
    datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
    query: { "eo:cloud_cover": { lt: maxCloud } },
    limit: 100,
    sortby: [{ field: "properties.datetime", direction: "asc" }],
  };
  for (let page = 0; page < 40 && items.length < limit; page++) {
    const r = await fetch(`${STAC_URL}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`STAC search failed: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { features: StacItem[]; links?: { rel: string; body?: Record<string, unknown>; href?: string }[] };
    items.push(...j.features);
    const next = j.links?.find((l) => l.rel === "next");
    if (!next) break;
    body = next.body ? { ...body, ...next.body } : { ...body, next: (j as unknown as { next?: string }).next };
    if (!next.body) break;
  }
  return items.slice(0, limit);
}

function epsgOf(item: StacItem, asset?: { "proj:epsg"?: number; "proj:code"?: string }): number {
  const code = asset?.["proj:code"] ?? item.properties["proj:code"];
  if (typeof code === "string" && code.startsWith("EPSG:")) return Number(code.slice(5));
  const e = asset?.["proj:epsg"] ?? item.properties["proj:epsg"];
  if (typeof e === "number") return e;
  throw new Error(`no projection on item ${item.id}`);
}

function utmDef(epsg: number): string {
  const zone = epsg % 100;
  const south = Math.floor(epsg / 100) === 327;
  return `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
}

function assetHref(item: StacItem, ...names: string[]): { href: string; meta: StacItem["assets"][string] } {
  for (const n of names) if (item.assets[n]) return { href: item.assets[n].href, meta: item.assets[n] };
  throw new Error(`asset ${names.join("|")} missing on ${item.id}`);
}

/**
 * Reflectance scaling. Since processing baseline 04.00 (Jan 2022) ESA's Sentinel-2 L2A digital numbers
 * carry an additive offset of 1000 (reflectance = (DN - 1000) / 10000). Some mirrors (Earth Search's
 * `sentinel-2-l2a` COGs) remove that offset again while still advertising it in STAC metadata, so we
 * do not trust metadata alone: NDVI is a ratio and gets an additive offset wrong by a lot. We detect
 * the offset empirically per scene from the low end of the DN distribution inside the window: land
 * surfaces never have a reflectance below ~0, so a 1st percentile DN >= 900 means the offset is present.
 */
function detectOffset(values: ArrayLike<number>): number {
  const a: number[] = [];
  for (let i = 0; i < values.length; i++) if (values[i] > 0) a.push(values[i]);
  if (a.length < 20) return 0;
  a.sort((x, y) => x - y);
  return a[Math.floor(a.length * 0.01)] >= 900 ? 1000 : 0;
}

interface Window { x0: number; y0: number; x1: number; y1: number; originX: number; originY: number; resX: number; resY: number }

function windowFor(img: GeoTIFFImage, bbox: [number, number, number, number]): Window {
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution(); // ry is negative (north-up)
  const w = img.getWidth(), h = img.getHeight();
  const x0 = Math.max(0, Math.floor((bbox[0] - ox) / rx));
  const x1 = Math.min(w, Math.ceil((bbox[2] - ox) / rx));
  const y0 = Math.max(0, Math.floor((bbox[3] - oy) / ry));
  const y1 = Math.min(h, Math.ceil((bbox[1] - oy) / ry));
  return { x0, y0, x1, y1, originX: ox, originY: oy, resX: rx, resY: ry };
}

export interface NdviResult {
  sceneId: string;
  date: string;
  offsetDetected: number;
  ndviMean: number;
  ndviP10: number;
  ndviP90: number;
  validFraction: number;
  pixelCount: number;
  cloudCover: number | null;
}

/** Compute masked NDVI statistics for one scene over a polygon. Returns null if too few clear pixels. */
export async function ndviForScene(item: StacItem, geom: PlaceGeometry, minValidFraction = 0.5): Promise<NdviResult | null> {
  const red = assetHref(item, "red", "B04");
  const nir = assetHref(item, "nir", "B08");
  const scl = assetHref(item, "scl", "SCL");
  const epsg = epsgOf(item, red.meta);
  const toUtm = proj4("EPSG:4326", utmDef(epsg));

  // project polygon rings
  const rings = polygons(geom).map((poly) => poly.map((ring) => ring.map(([lon, lat]) => toUtm.forward([lon, lat]))));
  const flat = rings.flat(2);
  const bbox: [number, number, number, number] = [
    Math.min(...flat.map((p) => p[0])), Math.min(...flat.map((p) => p[1])),
    Math.max(...flat.map((p) => p[0])), Math.max(...flat.map((p) => p[1])),
  ];

  const [tr, tn, ts] = await Promise.all([fromUrl(red.href), fromUrl(nir.href), fromUrl(scl.href)]);
  const [ir, inr, is] = await Promise.all([tr.getImage(), tn.getImage(), ts.getImage()]);
  const wr = windowFor(ir, bbox), ws = windowFor(is, bbox);
  if (wr.x1 <= wr.x0 || wr.y1 <= wr.y0) return null;

  const [rr, rn, rs] = await Promise.all([
    ir.readRasters({ window: [wr.x0, wr.y0, wr.x1, wr.y1] }),
    inr.readRasters({ window: [wr.x0, wr.y0, wr.x1, wr.y1] }),
    is.readRasters({ window: [ws.x0, ws.y0, ws.x1, ws.y1] }),
  ]);
  const R = rr[0] as unknown as ArrayLike<number>, N = rn[0] as unknown as ArrayLike<number>, S = rs[0] as unknown as ArrayLike<number>;
  const offset = detectOffset(R);
  const wN = wr.x1 - wr.x0, sN = ws.x1 - ws.x0;
  const vals: number[] = [];
  let inside = 0;
  for (let py = wr.y0; py < wr.y1; py++) {
    const y = wr.originY + (py + 0.5) * wr.resY;
    for (let px = wr.x0; px < wr.x1; px++) {
      const x = wr.originX + (px + 0.5) * wr.resX;
      if (!rings.some((poly) => pointInRings(x, y, poly))) continue;
      inside++;
      const sx = Math.floor((x - ws.originX) / ws.resX) - ws.x0, sy = Math.floor((y - ws.originY) / ws.resY) - ws.y0;
      const cls = sx >= 0 && sy >= 0 && sx < sN ? S[sy * sN + sx] : 0;
      if (!KEEP_SCL.has(cls)) continue;
      const i = (py - wr.y0) * wN + (px - wr.x0);
      const rawR = R[i], rawN = N[i];
      if (rawR === 0 && rawN === 0) continue; // nodata
      const r = rawR - offset, n = rawN - offset;
      if (r + n <= 0) continue;
      const v = (n - r) / (n + r);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (inside === 0) return null;
  const validFraction = vals.length / inside;
  if (validFraction < minValidFraction || vals.length < 3) return null;
  vals.sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    sceneId: item.id,
    date: item.properties.datetime,
    offsetDetected: offset,
    ndviMean: mean,
    ndviP10: q(0.1),
    ndviP90: q(0.9),
    validFraction,
    pixelCount: vals.length,
    cloudCover: typeof item.properties["eo:cloud_cover"] === "number" ? (item.properties["eo:cloud_cover"] as number) : null,
  };
}

export function defaultFrom(): string {
  const y = new Date().getUTCFullYear() - 7; // seven years of archive: enough for 2018/2020/2022 droughts in Europe
  return `${y}-01-01`;
}

export function bboxOf(geom: PlaceGeometry) {
  return turf.bbox(geom);
}
