/**
 * Checks for the switch that keeps a place's node to itself (Place.nodePublic), run against a database of your own:
 * npm run public:test
 *
 * DATABASE_URL must point at a database on this machine with every migration applied (`npx prisma migrate deploy`);
 * the script refuses any other host, because it creates and deletes places. It asks every route that shows a place's
 * node data as a visitor without a session, with the place's steward key, with another place's steward key and with
 * the admin key. A signed-in owner goes through `canSeeExact` and `canManage` with the session cookie, which needs a
 * request inside Next.js; the pages (the dashboard, the place page, the home page, /triage) do too, so they are
 * checked on a running site, not here.
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
// species no real node hears, so the open data's answer can be read for this test's places alone
const KEPT = "Testus servatus", OPEN = "Testus apertus", HIDDEN = "Testus celatus";

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
  const publicRoute = await import("../src/app/api/v1/places/[id]/node/public/route");
  const heardRoute = await import("../src/app/api/v1/heard/route");
  const nodesRoute = await import("../src/app/api/v1/nodes/route");
  const audioRoute = await import("../src/app/api/clips/[id]/audio/route");
  const { triageClips, triageDevices } = await import("../src/lib/triage");
  const { nodeStates } = await import("../src/lib/node");

  const stamp = Date.now();
  const mkPlace = (name: string, isPublic: boolean) => prisma.place.create({
    data: { slug: `public-test-${name}-${stamp}`, name: `Public test, ${name}`, geometry: { type: "Point", coordinates: [5, 52] }, centroidLat: 52, centroidLon: 5, areaHa: 1, public: isPublic },
  });
  // kept: a public place whose owner keeps its node to itself; open: a public place as every place was; hidden: a
  // private place, whose node stays public as before; shut: a private place, for the answer a visitor gets there
  const [kept, open, hidden, shut] = await Promise.all([mkPlace("kept", true), mkPlace("open", true), mkPlace("hidden", false), mkPlace("shut", false)]);
  const ids = [kept.id, open.id, hidden.id, shut.id];
  try {
    assert.equal(kept.nodePublic, true, "a new place's node is public: nothing changes for a place until its owner says so");
    await prisma.apiKey.createMany({ data: [
      { name: "steward:public-test", role: "STEWARD", keyHash: sha(STEWARD), placeId: kept.id },
      { name: "steward:public-test-other", role: "STEWARD", keyHash: sha(OTHER_STEWARD), placeId: open.id },
    ] });
    const now = new Date();
    const node = async (placeId: string, species: string, token?: string) => {
      const d = await prisma.device.create({
        data: { placeId, kind: "SOUND", model: "life-node-test", tokenHash: sha(token ?? `${placeId}-token`), lastSeenAt: now, lastHeartbeatAt: now, maintenanceFrom: now, maintenanceUntil: new Date(now.getTime() + 3600e3) },
      });
      await prisma.heartbeat.create({ data: { deviceId: d.id, ts: now, event: "hourly", metrics: { vinV: 13.1, cpuTempC: 40 } } });
      await prisma.soundDetection.create({ data: { deviceId: d.id, ts: now, species, scientific: species, confidence: 0.95, detector: "test" } });
      const file = `${d.id}/clip.m4a`;
      mkdirSync(path.join(process.env.CLIP_DIR!, d.id), { recursive: true });
      writeFileSync(path.join(process.env.CLIP_DIR!, file), "fake m4a");
      const clip = await prisma.clip.create({ data: { deviceId: d.id, detectionRef: `${species}-1`, ts: now, scientific: species, species, confidence: 0.9, file, mime: "audio/mp4" } });
      return { device: d, clip };
    };
    const k = await node(kept.id, KEPT, DEVICE);
    const o = await node(open.id, OPEN);
    await node(hidden.id, HIDDEN);

    const req = (auth?: string, method = "GET", body?: unknown, q = "") => new Request(`http://oracle.test/x${q}`, {
      method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const at = (id: string) => ({ params: Promise.resolve({ id }) });
    const read = async (r: Response) => ({ status: r.status, body: await r.json() });
    const heardItems = async (q = "") => read(await heardRoute.GET(req(undefined, "GET", undefined, `?limit=20&min=0${q}`)));
    const names = (b: { items: { scientific: string }[] }) => b.items.map((i) => i.scientific);
    const slugs = (b: { nodes: { slug: string }[] }) => b.nodes.map((n) => n.slug);

    // --- before the switch: everything shows, as it did ---
    assert.equal((await nodeRoute.GET(req(), at(kept.slug))).status, 200, "the dashboard as data is public by default");
    assert.equal((await nodeRoute.GET(req(), at(hidden.slug))).status, 200, "also for a private place, as decided on 11 October");
    assert.ok(names((await heardItems()).body).includes(KEPT), "the open data has the place's birds");
    assert.equal((await audioRoute.GET(req(), at(k.clip.id))).status, 200, "a clip plays for every visitor");

    // --- who may flip it ---
    assert.equal((await publicRoute.PUT(req(undefined, "PUT", { public: false }), at(kept.slug))).status, 401, "nobody signed in");
    assert.equal((await publicRoute.PUT(req(DEVICE, "PUT", { public: false }), at(kept.slug))).status, 401, "the node's own token does not manage its place");
    assert.equal((await publicRoute.PUT(req(OTHER_STEWARD, "PUT", { public: false }), at(kept.slug))).status, 401, "another place's steward key");
    assert.equal((await publicRoute.GET(req(), at(kept.slug))).status, 401, "nor may anyone else read it");
    assert.equal((await publicRoute.PUT(req(STEWARD, "PUT", { public: "no" }), at(kept.slug))).status, 400, "public is true or false");
    assert.equal((await publicRoute.PUT(req(STEWARD, "PUT", {}), at(kept.slug))).status, 400);
    assert.equal((await publicRoute.PUT(req(STEWARD, "PUT", { public: false }), at("no-such-place"))).status, 404);
    assert.deepEqual(await read(await publicRoute.PUT(req(STEWARD, "PUT", { public: false }), at(kept.slug))), { status: 200, body: { place: kept.slug, public: false } }, "the place's steward key flips it");
    assert.deepEqual((await read(await publicRoute.GET(req(STEWARD), at(kept.id)))).body, { place: kept.slug, public: false }, "and reads it, by id too");
    assert.equal((await read(await publicRoute.GET(req(ADMIN), at(kept.slug)))).body.public, false, "the admin key reads it");

    // --- off: a visitor gets what a private place gives ---
    const shutAnswer = await read(await placeRoute.GET(req(), at(shut.slug)));
    assert.deepEqual(shutAnswer, { status: 404, body: { error: "not found" } }, "what a private place answers a visitor");
    assert.deepEqual(await read(await nodeRoute.GET(req(), at(kept.slug))), shutAnswer, "the dashboard as data: the same answer");
    assert.deepEqual(await read(await statusRoute.GET(req(), at(kept.slug))), shutAnswer, "the status panel: the same answer");
    assert.deepEqual(await read(await nodeRoute.GET(req(OTHER_STEWARD), at(kept.slug))), shutAnswer, "another place's steward is a visitor here");
    assert.equal((await nodeRoute.GET(req(STEWARD), at(kept.slug))).status, 200, "the place's steward key sees it");
    assert.equal((await nodeRoute.GET(req(ADMIN), at(kept.slug))).status, 200, "the admin key sees it");
    assert.equal((await statusRoute.GET(req(STEWARD), at(kept.slug))).status, 200);
    assert.equal((await nodeRoute.GET(req(), at(open.slug))).status, 200, "another place's node stays public");
    assert.equal((await nodeRoute.GET(req(), at(hidden.slug))).status, 200, "and a private place's node too, while its owner leaves it public");

    // the clips: their sound and /triage
    assert.equal((await audioRoute.GET(req(), at(k.clip.id))).status, 404, "a visitor does not hear the place's clips");
    const heardByKey = await audioRoute.GET(req(STEWARD), at(k.clip.id));
    assert.equal(heardByKey.status, 200, "the place's steward key does");
    assert.equal(await heardByKey.text(), "fake m4a");
    assert.equal((await audioRoute.GET(req(), at(o.clip.id))).status, 200, "another place's clips still play for everyone");
    const { devices: listed } = await triageDevices(null);
    assert.ok(listed.some((d) => d.id === o.device.id) && !listed.some((d) => d.id === k.device.id), "/triage leaves the place's node out for a visitor");
    assert.deepEqual(await triageClips(KEPT, null), [], "and its clips");
    assert.equal((await triageClips(OPEN, null)).length, 1, "another place's clips stay on /triage");

    // the lists made for everyone: the open data, the map and the globe, the home page
    const all = (await heardItems()).body;
    assert.ok(!names(all).includes(KEPT) && names(all).includes(OPEN) && names(all).includes(HIDDEN), "the open data leaves the place's birds out");
    assert.ok(!slugs(all).includes(kept.slug) && slugs(all).includes(open.slug), "and the node from its list of nodes");
    assert.deepEqual(await heardItems(`&place=${kept.slug}`), { status: 404, body: { error: "not found" } }, "?place= of the place: not found");
    assert.deepEqual(names((await heardItems(`&place=${open.slug}`)).body), [OPEN], "?place= of another place answers as before");
    const signals = (await read(await nodesRoute.GET())).body.items.map((s: { slug: string }) => s.slug);
    assert.ok(!signals.includes(kept.slug) && signals.includes(open.slug) && signals.includes(hidden.slug), "the map and the globe leave its signal out");
    const states = (await nodeStates()).map((s) => s.slug);
    assert.ok(!states.includes(kept.slug) && states.includes(open.slug), "the home page's node button never points at it");

    // the place itself stays public, without its devices' last posts
    const place = await read(await placeRoute.GET(req(), at(kept.slug)));
    assert.equal(place.status, 200, "the place page's data stays public: it has its own switch");
    assert.equal(place.body.devices[0].lastSeenAt, null, "but a device's last post is node data");
    assert.notEqual((await read(await placeRoute.GET(req(STEWARD), at(kept.slug)))).body.devices[0].lastSeenAt, null, "the steward key still sees it");
    const devices = await read(await devicesRoute.GET(req(), at(kept.slug)));
    assert.deepEqual(
      [devices.body.items[0].lastSeenAt, devices.body.items[0].lastHeartbeatAt, devices.body.items[0].maintenanceFrom, devices.body.items[0].maintenanceUntil], [null, null, null, null],
      "the device list leaves out last seen, the last heartbeat and the alarm window",
    );
    assert.equal(devices.body.items[0].model, "life-node-test", "the device itself stays listed");
    const keyDevices = (await read(await devicesRoute.GET(req(STEWARD), at(kept.slug)))).body.items[0];
    assert.ok(keyDevices.lastSeenAt && keyDevices.lastHeartbeatAt && keyDevices.maintenanceUntil, "the steward key sees them");
    assert.notEqual((await read(await devicesRoute.GET(req(), at(open.slug)))).body.items[0].lastSeenAt, null, "another place's devices keep theirs");

    // --- the place's PATCH takes it too, and on again everything shows ---
    assert.equal((await placeRoute.PATCH(req(OTHER_STEWARD, "PATCH", { nodePublic: true }), at(kept.slug))).status, 401, "not with another place's key");
    assert.equal((await placeRoute.PATCH(req(STEWARD, "PATCH", { nodePublic: true }), at(kept.slug))).status, 200);
    assert.equal((await nodeRoute.GET(req(), at(kept.slug))).status, 200, "public again");
    assert.equal((await audioRoute.GET(req(), at(k.clip.id))).status, 200);
    assert.ok(names((await heardItems()).body).includes(KEPT), "back in the open data");
    assert.ok((await triageDevices(null)).devices.some((d) => d.id === k.device.id), "and on /triage");

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
