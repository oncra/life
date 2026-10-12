// The part of the node dashboard that the browser needs too (the map draws the signals): no database here.

/** The node posts every three hours (since 11 October 2026, oncra/life #73; node/life-sound.timer); a silence longer
 * than this is a missed post. */
export const POST_EVERY_H = 3;

/** One signal per place that has a device which has reported: the pulsing dots on the map. For the public the point is
 * a blurred one (see `signalPoint` in src/lib/node.ts). */
export type NodeSignal = {
  slug: string; name: string; lat: number; lon: number; radiusM: number | null;
  heardAt: string | null; heartbeatAt: string | null; lastSpecies: string | null; lastSpeciesAt: string | null; speciesWeek: number; href: string;
};

/** Live when heard inside the posting rhythm plus a margin, stale until the silent alert would open, silent after. */
export function signalStatus(heardAt: string | number | null, now: number): "live" | "stale" | "silent" {
  if (!heardAt) return "silent";
  const age = now - new Date(heardAt).getTime();
  return age < (POST_EVERY_H + 1) * 3600e3 ? "live" : age < 36 * 3600e3 ? "stale" : "silent";
}
