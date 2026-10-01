import type { Box } from "@/generated/prisma/client";

/** What the box page shows about one box. The node password is for people who want to log in to the box itself. */
export function boxOut(b: Box & { place: { slug: string } }) {
  return {
    id: b.id, name: b.name, hostname: b.hostname, nodePassword: b.nodePassword, wifiSsid: b.wifiSsid,
    imageStatus: b.imageStatus, imageError: b.imageError, imageVersion: b.imageVersion, imageBytes: b.imageBytes ? Number(b.imageBytes) : null,
    builtAt: b.builtAt, placedAt: b.placedAt, placeSlug: b.place.slug, createdAt: b.createdAt,
  };
}
