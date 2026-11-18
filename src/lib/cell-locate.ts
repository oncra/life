/** Where a node is, worked out from the 4G cell its stick hears, for a demo (Place.demoUntil) only. The cell goes to an
 * open location database that needs no account; nothing of it is stored here, only the answer, on the device's live row,
 * which the next live post overwrites. Outside a demo this is never asked: a node's dashboard says nothing about where
 * it stands. A mast is a few hundred metres to a few kilometres of accuracy, which the demo map draws as a circle. */

export type CellPos = { lat: number; lon: number; accM: number; source: string; at: number };
type CellIn = { plmn?: string; tac?: string | number; cellId?: string | number; mode?: string };
type Key = { mcc: number; mnc: number; tac: number; cid: number; radio: "lte" | "wcdma" | "gsm" };

const FOUND_MS = 6 * 3600e3; // a mast does not move: ask again after six hours
const MISS_MS = 10 * 60e3; // unknown to every source: ask again after ten minutes
const cache = new Map<string, { pos: CellPos | null; until: number }>();

const int = (v: unknown): number | null => {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d+$/.test(s) ? Number(s) : null;
};

/** The HiLink stick gives the PLMN as one string (MCC + MNC), the cell id and the area code in decimal, and its mode as
 * a number: 7 is LTE, 2 is WCDMA, 0 or 3 GSM. */
export function cellKey(c: CellIn | null | undefined): Key | null {
  if (!c?.plmn || !/^\d{5,6}$/.test(c.plmn)) return null;
  const tac = int(c.tac), cid = int(c.cellId);
  if (tac === null || cid === null || cid === 0) return null;
  const mode = String(c.mode ?? "7");
  const radio = mode === "2" ? "wcdma" : mode === "0" || mode === "3" ? "gsm" : "lte";
  return { mcc: Number(c.plmn.slice(0, 3)), mnc: Number(c.plmn.slice(3)), tac, cid, radio };
}

async function beacondb(k: Key): Promise<Omit<CellPos, "at"> | null> {
  const r = await fetch("https://api.beacondb.net/v1/geolocate", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "life-oracle (life.oncra.org)" },
    body: JSON.stringify({ considerIp: false, cellTowers: [{ radioType: k.radio, mobileCountryCode: k.mcc, mobileNetworkCode: k.mnc, locationAreaCode: k.tac, cellId: k.cid }] }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return null;
  const d = (await r.json()) as { location?: { lat?: number; lng?: number }; accuracy?: number };
  const lat = d.location?.lat, lon = d.location?.lng;
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon, accM: Math.round(d.accuracy ?? 1000), source: "beaconDB" } : null;
}

/** The sources in the order they are asked; the first that knows the mast answers. */
const SOURCES: ((k: Key) => Promise<Omit<CellPos, "at"> | null>)[] = [beacondb];

export async function locateCell(c: CellIn | null | undefined, now = Date.now()): Promise<CellPos | null> {
  const k = cellKey(c);
  if (!k) return null;
  const id = `${k.radio}:${k.mcc}:${k.mnc}:${k.tac}:${k.cid}`;
  const hit = cache.get(id);
  if (hit && hit.until > now) return hit.pos;
  let pos: CellPos | null = null;
  for (const src of SOURCES) {
    const p = await src(k).catch(() => null);
    if (p) {
      pos = { ...p, at: now };
      break;
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(id, { pos, until: now + (pos ? FOUND_MS : MISS_MS) });
  return pos;
}
