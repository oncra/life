import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon, Position } from "geojson";

export type PlaceGeometry = Polygon | MultiPolygon;

export function normalizeGeometry(input: unknown): PlaceGeometry {
  let g: unknown = input;
  if (g && typeof g === "object" && (g as Feature).type === "Feature") g = (g as Feature).geometry;
  if (!g || typeof g !== "object") throw new Error("geometry required");
  const t = (g as { type?: string }).type;
  if (t !== "Polygon" && t !== "MultiPolygon") throw new Error("geometry must be a Polygon or MultiPolygon");
  const geom = g as PlaceGeometry;
  turf.area(geom); // throws on malformed
  return geom;
}

export function summarize(geom: PlaceGeometry) {
  const areaHa = turf.area(geom) / 10_000;
  const c = turf.centroid(geom).geometry.coordinates;
  const bbox = turf.bbox(geom) as [number, number, number, number];
  return { areaHa, centroidLon: c[0], centroidLat: c[1], bbox };
}

/** Ray-casting point-in-polygon on already-projected coordinates. */
export function pointInRings(x: number, y: number, rings: Position[][]): boolean {
  let inside = false;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    if (r === 0) inside = hit; // outer ring
    else if (hit) inside = false; // inside a hole
  }
  return inside;
}

export function polygons(geom: PlaceGeometry): Position[][][] {
  return geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "place";
}
