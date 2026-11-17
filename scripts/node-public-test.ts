/**
 * Checks that a node's data stays public for every place, and that a place which hides its location
 * (Place.locationHidden) gives a viewer without exact access no exact position wherever its node shows. Run against a
 * database of your own: npm run public:test
 *
 * DATABASE_URL must point at a database on this machine with every migration applied (`npx prisma migrate deploy`);
 * the script refuses any other host, because it creates and deletes places. It asks the routes as a visitor without a
 * session, with the place's steward key, with another place's steward key, with the node's own token and with the
 * admin key. The signed-in owner's switch goes through `canManage` with the session cookie, which needs a request
 * inside Next.js, so it and the pages are checked on a running site, not here.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ADMIN = "admin-key-for-the-public-test";
const STEWARD = `lo_key_${"publictest".repeat(3)}`;
const OTHER_STEWARD = `lo_key_${"othertest".repeat(3)}`;
const DEVICE = `lo_dev_${"publictest".repeat(3)}`;
// a species no real node hears, so the open data's answer can be read for this test's place alone
const KEPT = "Testus servatus";
// where the place and its node stand, and its 4G cell: none of it may reach a viewer without exact access
const LAT = 52.71234567, LON = 6.04321987, DLAT = 52.71240011, DLON = 6.04330022;
const CELL = { plmn: "20416", cellId: "C0FFEE77", tac: "7A11", pci: 321, band: "B20", rsrp: -101, rssi: -71, sinr: 4, mode: "LTE" };
const DAY = 864e5;

/** Every number in a JSON answer. */
const numbers = (v: unknown, out: number[] = []): number[] => {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) for (const x of v) numbers(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) numbers(x, out);
  return out;
};
/** What of where the node stands an answer gives away: the exact coordinates, or the cell's identity. */
const leaks = (body: unknown) => {
  const text = JSON.stringify(body);
  return [
    ...numbers(body).filter((n) => [LAT, LON, DLAT, DLON].some((x) => Math.abs(n - x) < 1e-9)).map(String),
    ...[CELL.cellId, CELL.tac, String(LAT), String(LON)].filter((s) => text.includes(s)),
  ];
};
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6_371_000;
};

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://none");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("public:test runs only against a database on localhost");
  const tmp = mkdtempSync(path.join(tmpdir(), "public-test-"));
  process.env.CLIP_DIR = path.join(tmp, "clips");
  process.env.ADMIN_API_KEY = ADMIN;
  delete process.env.CHECKIN_WEBHOOK_URL;
  delete process.env.ALERT_WEBHOOK_URL;
  const { prisma } = await import("../src/lib/db");
  const placeRoute = await import("../src/app/api/v1/places/[id]/route");
  const devicesRoute = await import("../src/app/api/v1/places/[id]/devices/route");
  const nodeRoute = await import("../src/app/api/v1/places/[id]/node/route");
  const statusRoute = await import("../src/app/api/v1/places/[id]/node/status/route");
  const heardRoute = await import("../src/app/api/v1/heard/route");
  const nodesRoute = await import("../src/app/api/v1/nodes/route");
  const audioRoute = await import("../src/app/api/clips/[id]/audio/route");
  const { triageClips, triageDevices } = await import("../src/lib/triage");
  const { nodeStates } = await import("../src/lib/node");
  const { nights } = await import("../src/lib/sun");
  const { METHOD_RULES, ruleWindows } = await import("../src/lib/listening");
  const { DISPLAY_ZONE } = await import("../src/lib/clock");

  const stamp = Date.now();
  const mkPlace = (name: string, lat: number, lon: number) => prisma.place.create({
    data: { slug: `public-test-${name}-${stamp}`, name: `Public test, ${name}`, geometry: { type: "Point", coordinates: [lon, lat] }, centroidLat: lat, centroidLon: lon, areaHa: 1, public: true },
  });
  // kept: a public place whose owner hides where its node stands; open: a public place that shows it
  const [kept, open] = await Promise.all([mkPlace("kept", LAT, LON), mkPlace("open", 52.1, 5.1)]);
  const ids = [kept.id, open.id];
  try {
    assert.equal(kept.locationHidden, false);
    await prisma.apiKey.createMany({ data: [
      { name: "steward:public-test", role: "STEWARD", keyHash: sha(STEWARD), placeId: kept.id },
      { name: "steward:public-test-other", role: "STEWARD", keyHash: sha(OTHER_STEWARD), placeId: open.id },
    ] });
    const now = new Date();
    const node = async (placeId: string, lat: number, lon: number, species: string, token: string) => {
      const d = await prisma.device.create({
        data: { placeId, kind: "SOUND", model: "life-node-test", tokenHash: sha(token), lat, lon, lastSeenAt: now, lastHeartbeatAt: now },
      });
      // a shutdown post: the status panel then says when the node wakes, which it works out from the sun
      await prisma.heartbeat.create({ data: { deviceId: d.id, ts: now, event: "shutdown", cell: CELL, metrics: { vinV: 13.1, cpuTempC: 40 } } });
      await prisma.soundDetection.create({ data: { deviceId: d.id, ts: now, species, scientific: species, confidence: 0.95, detector: "test" } });
      const file = `${d.id}/clip.m4a`;
      mkdirSync(path.join(process.env.CLIP_DIR!, d.id), { recursive: true });
      writeFileSync(path.join(process.env.CLIP_DIR!, file), "fake m4a");
      const clip = await prisma.clip.create({ data: { deviceId: d.id, detectionRef: `${species}-1`, ts: now, scientific: species, species, confidence: 0.9, file, mime: "audio/mp4" } });
      return { device: d, clip };
    };
    const k = await node(kept.id, DLAT, DLON, KEPT, DEVICE);
    await node(open.id, 52.1001, 5.1001, "Testus apertus", `${open.id}-token`);

    const req = (auth?: string, method = "GET", body?: unknown, q = "") => new Request(`http://oracle.test/x${q}`, {
      method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const at = (id: string) => ({ params: Promise.resolve({ id }) });
    const read = async (r: Response) => ({ status: r.status, body: await r.json() });
    const patch = async (auth: string | undefined, body: unknown) => read(await placeRoute.PATCH(req(auth, "PATCH", body), at(kept.slug)));
    const signals = async () => (await read(await nodesRoute.GET())).body.items as { slug: string; lat: number; lon: number; radiusM: number | null }[];

    // shown, as every place starts: the device's position is public
    assert.equal((await read(await devicesRoute.GET(req(), at(kept.slug)))).body.items[0].lat, DLAT, "a place that shows its location shows its devices");

    // --- who may hide it: the place's managers, never a stranger ---
    assert.equal((await patch(undefined, { locationHidden: true })).status, 401, "nobody signed in");
    assert.equal((await patch(DEVICE, { locationHidden: true })).status, 401, "the node's own token does not manage its place");
    assert.equal((await patch(OTHER_STEWARD, { locationHidden: true })).status, 401, "another place's steward key");
    assert.equal((await patch(STEWARD, { locationHidden: "yes" })).status, 400, "locationHidden is true or false");
    const hid = await patch(STEWARD, { locationHidden: true });
    assert.equal(hid.status, 200, "the place's steward key hides it");
    assert.equal(hid.body.place.locationHidden, true);
    assert.equal(hid.body.place.blurRadiusM, 1000, "with the default circle of 1 km");
    const blur = { lat: hid.body.place.blurLat as number, lon: hid.body.place.blurLon as number };
    const off = metres(blur, { lat: LAT, lon: LON });
    assert.ok(off >= 290 && off <= 710, `the circle's centre lies 300 to 700 m from where it stands (${off.toFixed(0)} m)`);

    // --- hidden: the node's data stays public for everyone ---
    const data = await read(await nodeRoute.GET(req(), at(kept.slug)));
    assert.equal(data.status, 200, "the dashboard as data stays public");
    assert.ok(data.body.species.some((s: { scientific: string | null }) => s.scientific === KEPT), "with the species it heard");
    const status = await read(await statusRoute.GET(req(), at(kept.slug)));
    assert.equal(status.status, 200, "the status panel stays public");
    assert.equal(status.body.link.operator, "Odido (T-Mobile NL)", "it names the operator");
    assert.equal((await audioRoute.GET(req(), at(k.clip.id))).status, 200, "the clips play for everyone");
    const heard = await read(await heardRoute.GET(req(undefined, "GET", undefined, "?limit=20&min=0")));
    assert.ok(heard.body.items.some((i: { scientific: string }) => i.scientific === KEPT), "the open data has the birds it heard");
    assert.ok(heard.body.nodes.some((n: { slug: string }) => n.slug === kept.slug), "and the node in its list of nodes");
    assert.ok((await nodeStates()).some((s) => s.slug === kept.slug), "the home page's node list has it");
    assert.ok((await triageDevices(null)).devices.some((d) => d.id === k.device.id), "/triage has its node");
    assert.equal((await triageClips(KEPT, null)).length, 1, "and its clips");

    // --- but nobody without exact access learns where it stands ---
    const sig = (await signals()).find((s) => s.slug === kept.slug);
    assert.deepEqual(sig && { lat: sig.lat, lon: sig.lon, radiusM: sig.radiusM }, { ...blur, radiusM: 1000 }, "the map and the globe draw the circle, for every viewer");
    const openSig = (await signals()).find((s) => s.slug === open.slug);
    assert.deepEqual(openSig && [openSig.lat, openSig.lon, openSig.radiusM], [52.1, 5.1, null], "a place that shows its location keeps its point");
    const place = await read(await placeRoute.GET(req(), at(kept.slug)));
    assert.equal(place.body.place.approximate, true, "the place page draws the circle");
    assert.deepEqual([place.body.place.centroidLat, place.body.place.centroidLon], [blur.lat, blur.lon]);
    assert.deepEqual([place.body.devices[0].lat, place.body.devices[0].lon], [null, null], "without the devices' positions");
    assert.notEqual(place.body.devices[0].lastSeenAt, null, "but with their last post: that is node data");
    const devices = await read(await devicesRoute.GET(req(), at(kept.slug)));
    assert.deepEqual([devices.body.items[0].lat, devices.body.items[0].lon], [null, null], "the device list leaves the positions out");
    assert.ok(devices.body.items[0].lastSeenAt && devices.body.items[0].lastHeartbeatAt, "and keeps the rest");
    for (const [what, body] of [["the place", place.body], ["its devices", devices.body], ["the dashboard", data.body], ["the status", status.body], ["the open data", heard.body], ["the signals", await signals()]] as const) {
      assert.deepEqual(leaks(body), [], `${what} gives away nothing of where it stands`);
    }
    // sunrise and sunset to the millisecond give back the point they were worked out for, so a visitor's night bands
    // and windows are reckoned for the circle's centre
    const { from, to } = data.body as { from: number; to: number };
    assert.deepEqual(data.body.night, nights(from, to, blur.lat, blur.lon), "the night bands come from the circle's centre");
    assert.notDeepEqual(data.body.night, nights(from, to, LAT, LON));
    const starts = (lat: number, lon: number) => new Set([-2, -1, 0, 1, 2].flatMap((d) => ruleWindows(Date.now() + d * DAY, lat, lon, METHOD_RULES, DISPLAY_ZONE)).map((w) => w.start));
    assert.equal(status.body.next?.kind, "wake", "after its shutdown post the panel says when it wakes");
    assert.ok(starts(blur.lat, blur.lon).has(status.body.next.at) && !starts(LAT, LON).has(status.body.next.at), "worked out for the circle's centre");

    // --- the place's steward key, and the admin key, see where it stands ---
    for (const key of [STEWARD, ADMIN]) {
      const p = await read(await placeRoute.GET(req(key), at(kept.slug)));
      assert.deepEqual([p.body.place.centroidLat, p.body.devices[0].lat, p.body.devices[0].lon], [LAT, DLAT, DLON], "the exact centroid and device");
      const d = await read(await nodeRoute.GET(req(key), at(kept.slug)));
      assert.deepEqual(d.body.night, nights(d.body.from, d.body.to, LAT, LON), "night bands from where it stands");
      const s = await read(await statusRoute.GET(req(key), at(kept.slug)));
      assert.ok(starts(LAT, LON).has(s.body.next.at), "and its wake");
    }
    assert.deepEqual((await read(await devicesRoute.GET(req(OTHER_STEWARD), at(kept.slug)))).body.items[0].lat, null, "another place's steward key does not");

    // --- shown again, and hidden again around the same centre ---
    assert.equal((await patch(STEWARD, { locationHidden: false })).status, 200);
    assert.equal((await read(await devicesRoute.GET(req(), at(kept.slug)))).body.items[0].lat, DLAT, "shown: the device's position is public again");
    assert.deepEqual((await signals()).filter((s) => s.slug === kept.slug).map((s) => [s.lat, s.lon, s.radiusM]), [[LAT, LON, null]], "and the point on the map");
    const again = await patch(STEWARD, { locationHidden: true });
    assert.deepEqual([again.body.place.blurLat, again.body.place.blurLon], [blur.lat, blur.lon], "hidden again, the circle keeps its centre: a fresh one per flip could be averaged back to where it stands");
    assert.equal((await patch(ADMIN, { locationHidden: false })).status, 200, "the admin key may switch it too");

    console.log("public:test ok");
  } finally {
    await prisma.apiKey.deleteMany({ where: { keyHash: { in: [sha(STEWARD), sha(OTHER_STEWARD)] } } });
    await prisma.place.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
