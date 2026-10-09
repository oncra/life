import { randomInt } from "node:crypto";
import type { Place } from "@/generated/prisma/client";
import { prisma } from "./db";
import { authenticate, canManagePlace } from "./auth";
import { currentUser } from "./session";

// A place on someone's own land is also where they live. A place can therefore hide its exact location:
// the public sees a circle, the owner, the place's steward key and admins see the boundary.
// The circle's centre is moved a random distance from the true centroid, drawn once and stored. A fresh draw on
// every request would let anyone average a hundred answers back to the true centre.

export const DEFAULT_BLUR_M = 1000;
const EARTH_M = 6_371_000;

/** A random point up to 70% of the radius away from (lat, lon), so the true centre is always inside the circle
 * but never at its middle. */
export function blurCentre(lat: number, lon: number, radiusM: number): { lat: number; lon: number } {
  const dist = radiusM * (0.3 + 0.4 * (randomInt(0, 1_000_001) / 1_000_000));
  const bearing = (randomInt(0, 360_000) / 1000) * (Math.PI / 180);
  const dLat = (dist * Math.cos(bearing)) / EARTH_M;
  const dLon = (dist * Math.sin(bearing)) / (EARTH_M * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + (dLat * 180) / Math.PI, lon: lon + (dLon * 180) / Math.PI };
}

export function circle(lat: number, lon: number, radiusM: number, n = 64): GeoJSON.Polygon {
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push([lon + ((radiusM * Math.sin(a)) / (EARTH_M * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI), lat + ((radiusM * Math.cos(a)) / EARTH_M) * (180 / Math.PI)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** Hide or show a place's exact location. Hiding draws the blurred centre once; it is kept when hidden again. */
export async function setLocationHidden(place: Place, hidden: boolean, radiusM?: number) {
  const r = radiusM ?? place.blurRadiusM ?? DEFAULT_BLUR_M;
  const redraw = hidden && (place.blurLat == null || place.blurLon == null || (radiusM != null && radiusM !== place.blurRadiusM));
  const c = redraw ? blurCentre(place.centroidLat, place.centroidLon, r) : null;
  return prisma.place.update({ where: { id: place.id }, data: { locationHidden: hidden, blurRadiusM: r, ...(c ? { blurLat: c.lat, blurLon: c.lon } : {}) } });
}

/** After the boundary changes (a box is placed), a hidden place needs a new blurred centre around the new spot. */
export async function reblur(placeId: string) {
  const p = await prisma.place.findUnique({ where: { id: placeId } });
  if (p?.locationHidden) {
    const c = blurCentre(p.centroidLat, p.centroidLon, p.blurRadiusM ?? DEFAULT_BLUR_M);
    await prisma.place.update({ where: { id: p.id }, data: { blurLat: c.lat, blurLon: c.lon } });
  }
}

/** Who may see this place exactly: an admin (key, or signed in with an ADMIN_EMAILS address), the place's
 * steward key, the signed-in owner of a Life Node on it, or someone given access to it (PlaceAccess). `req` is given in API routes; pages use the cookie. */
export async function canSeeExact(place: Pick<Place, "id">, req?: Request): Promise<boolean> {
  if (req && canManagePlace(await authenticate(req), place.id)) return true;
  const user = await currentUser().catch(() => null);
  if (!user) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(user.email.toLowerCase())) return true;
  const [boxes, access] = await Promise.all([
    prisma.box.count({ where: { placeId: place.id, userId: user.id } }),
    prisma.placeAccess.count({ where: { placeId: place.id, userId: user.id } }),
  ]);
  return boxes + access > 0;
}

/** Whether a viewer may see this place at all: public places for everyone, private ones only for those who may see
 * them exactly. */
export async function canView(place: Pick<Place, "id" | "public">, req?: Request) {
  return place.public || canSeeExact(place, req);
}

/** The place as the public may see it: when the location is hidden, the boundary becomes the circle, the centroid
 * its centre, and the stored soil context loses its coordinates. Area and land use stay. */
export function publicPlace<P extends Place>(p: P, exact: boolean): P & { approximate: boolean; approximateRadiusM: number | null } {
  if (exact || !p.locationHidden || p.blurLat == null || p.blurLon == null) return { ...p, approximate: false, approximateRadiusM: null };
  const r = p.blurRadiusM ?? DEFAULT_BLUR_M;
  const ctx = (p.context ?? null) as { soil?: Record<string, unknown> } | null;
  const soil = ctx?.soil ? (({ lat: _a, lon: _b, ...rest }) => rest)(ctx.soil as { lat?: unknown; lon?: unknown }) : undefined;
  return {
    ...p,
    geometry: circle(p.blurLat, p.blurLon, r) as unknown as P["geometry"],
    centroidLat: p.blurLat,
    centroidLon: p.blurLon,
    context: (ctx ? { ...ctx, ...(soil ? { soil } : {}) } : null) as P["context"],
    blurLat: null,
    blurLon: null,
    approximate: true,
    approximateRadiusM: r,
  };
}

/** Device positions are dropped for viewers who may not see the place exactly. */
export function publicDevice<D extends { lat?: number | null; lon?: number | null }>(d: D, hide: boolean): D {
  return hide ? { ...d, lat: null, lon: null } : d;
}
