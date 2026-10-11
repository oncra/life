// Sunrise and sunset for a latitude and longitude, the usual sunrise equation (solar noon from the mean anomaly and the
// equation of centre, hour angle at -0.833 degrees for refraction and the sun's radius). Good to a few minutes, which is
// all the night bands on a chart need.

const rad = Math.PI / 180;

/** Sunrise and sunset (epoch ms) on the UTC day that contains `t`; null when the sun does not rise or set that day. */
export function sunTimes(t: number, lat: number, lon: number): { rise: number; set: number } | null {
  const n = Math.floor(t / 864e5) - 10957; // days since 2000-01-01
  const js = n - lon / 360; // mean solar time at this longitude, days since J2000
  const M = ((357.5291 + 0.98560028 * js) % 360 + 360) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return null;
  const H = Math.acos(cosH) / rad / 360;
  const toMs = (jd: number) => (jd - 2440587.5) * 864e5;
  return { rise: toMs(transit - H), set: toMs(transit + H) };
}

/** The nights between `from` and `to` as [sunset, next sunrise] pairs, clipped to the span. At most 400 nights. */
export function nights(from: number, to: number, lat: number, lon: number): [number, number][] {
  const out: [number, number][] = [];
  const day0 = Math.floor(from / 864e5) - 1;
  const day1 = Math.floor(to / 864e5);
  for (let d = day0; d <= day1 && out.length < 400; d++) {
    const a = sunTimes(d * 864e5, lat, lon);
    const b = sunTimes((d + 1) * 864e5, lat, lon);
    if (!a || !b) continue;
    const s = Math.max(a.set, from), r = Math.min(b.rise, to);
    if (r > s) out.push([s, r]);
  }
  return out;
}
