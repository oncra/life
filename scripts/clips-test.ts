/**
 * Checks for the clips that leave a node at a visit, run against a database of your own: npm run clips:test
 *
 * DATABASE_URL must point at a database on this machine with every migration applied (`npx prisma migrate deploy`);
 * the script refuses any other host, because it creates and deletes a place. python3 runs the node's own half of the
 * laptop grant (node/life-clips.py), so the two sides are checked against each other, not against a copy.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const TOKEN = `lo_dev_${"clipstest".repeat(4)}`;
const ADMIN = "admin-key-for-the-clips-test";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://none");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("clips:test runs only against a database on localhost");
  const tmp = mkdtempSync(path.join(tmpdir(), "clips-test-"));
  process.env.CLIP_DIR = path.join(tmp, "oracle-clips");
  process.env.ADMIN_API_KEY = ADMIN;
  delete process.env.CHECKIN_WEBHOOK_URL;
  delete process.env.ALERT_WEBHOOK_URL;
  const { prisma } = await import("../src/lib/db");
  const clipsRoute = await import("../src/app/api/v1/clips/route");
  const batchesRoute = await import("../src/app/api/v1/clips/batches/route");
  const soundRoute = await import("../src/app/api/v1/ingest/sound/route");
  const visitRoute = await import("../src/app/api/v1/places/[id]/devices/[deviceId]/visit/route");
  const maintenanceRoute = await import("../src/app/api/v1/places/[id]/devices/[deviceId]/maintenance/route");
  const zipRoute = await import("../src/app/api/v1/places/[id]/clips.zip/route");
  const { recordHeartbeat } = await import("../src/lib/alerts");
  const { pruneClips } = await import("../src/lib/clips");
  const { HeartbeatIn } = await import("../src/lib/ingest");
  const { itemsHash, readGrant, signedBy } = await import("../src/lib/grant");
  const { zipStream } = await import("../src/lib/zip");

  const place = await prisma.place.create({
    data: { slug: `clips-test-${Date.now()}`, name: "Clips test", geometry: { type: "Point", coordinates: [5, 52] }, centroidLat: 52, centroidLon: 5, areaHa: 1, public: false },
  });
  const other = await prisma.place.create({
    data: { slug: `clips-test-other-${Date.now()}`, name: "Clips test, other", geometry: { type: "Point", coordinates: [5, 52] }, centroidLat: 52, centroidLon: 5, areaHa: 1 },
  });
  try {
    const device = await prisma.device.create({ data: { placeId: place.id, kind: "SOUND", model: "life-node-test", tokenHash: sha(TOKEN) } });
    const stranger = await prisma.device.create({ data: { placeId: other.id, kind: "SOUND", model: "life-node-test", tokenHash: sha(`${TOKEN}-other`) } });

    // the node's half: node/life-clips.py signs, the oracle checks
    const state = path.join(tmp, "node-state");
    mkdirSync(state, { recursive: true });
    const nodeGrant = (deviceId: string, batch: string, items: { ref: string; sha256: string }[], now: number, token = TOKEN) => {
      writeFileSync(path.join(state, "visit.json"), JSON.stringify({ rev: 0, device: deviceId }));
      const code = [
        "import importlib.util, json, sys",
        "spec = importlib.util.spec_from_file_location('life_clips', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
        "a = json.loads(sys.argv[2]); items = [(i['ref'], i['sha256']) for i in a['items']]",
        "print(json.dumps({'grant': m.grant(a['batch'], items, a['now']), 'hash': m.items_hash(items)}))",
      ].join("\n");
      const r = spawnSync("python3", ["-I", "-c", code, path.resolve(__dirname, "../node/life-clips.py"), JSON.stringify({ batch, items, now })], {
        env: { ...process.env, LIFE_DEVICE_TOKEN: token, LIFE_STATE: state, LIFE_CLIPS_DIR: path.join(tmp, "node-clips") }, encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`python3: ${r.stderr}`);
      return JSON.parse(r.stdout) as { grant: string; hash: string };
    };

    const sound = (n: number) => Buffer.from(`fake m4a ${n} ${"x".repeat(200 + n)}`);
    const fields = (ref: string, extra: Record<string, string> = {}) => ({ detection: ref, time_utc: "2026-05-14T03:12:09+00:00", scientific: "Limosa limosa", score: "0.812", band: "0.8", detector: "birdnet-go", source: "AudioMoth", clip_s: "7", detection_from_s: "3", detection_to_s: "6", gain_db: "11.5", ...extra });
    const send = (auth: string, f: Record<string, string>, data: Buffer, name = "clip.m4a") => {
      const form = new FormData();
      for (const [k, v] of Object.entries(f)) form.set(k, v);
      form.set("file", new File([new Uint8Array(data)], name));
      return clipsRoute.POST(new Request("http://oracle.test/api/v1/clips", { method: "POST", headers: { authorization: auth }, body: form }));
    };
    const body = async (r: Response) => ({ status: r.status, ...(await r.json()) });

    // --- the grant's format, both sides ---
    const items = [1, 2, 3].map((n) => ({ ref: `${100 + n}@1778728329`, sha256: sha(sound(n)) }));
    const now = Math.floor(Date.now() / 1000);
    const g = nodeGrant(device.id, "a1b2c3d4e5f6", items, now);
    assert.equal(g.hash, itemsHash(items), "the batch fingerprint is the same on the node and the oracle");
    assert.equal(itemsHash([...items].reverse()), g.hash, "the fingerprint does not depend on order");
    const read = readGrant(g.grant)!;
    assert.ok(read, "the oracle reads the node's grant");
    assert.deepEqual({ ...read.grant, expiresAt: read.grant.expiresAt.getTime() }, { deviceId: device.id, batch: "a1b2c3d4e5f6", n: 3, hash: g.hash, expiresAt: (now + 90 * 86400) * 1000 });
    assert.ok(signedBy(read.payload, read.sig, sha(TOKEN)), "signed under the SHA-256 of the node's token");
    assert.ok(!signedBy(read.payload, read.sig, sha(`${TOKEN}x`)), "not under another token");
    const [, p64, s64] = g.grant.split(".");
    const forged = JSON.parse(Buffer.from(p64, "base64url").toString());
    forged.n = 4;
    assert.ok(!signedBy(Buffer.from(JSON.stringify(forged)).toString("base64url"), Buffer.from(s64, "base64url"), sha(TOKEN)), "a changed payload fails");
    for (const bad of ["", "lg1", "lg2.e30.e30", `lg1.${p64}`, `lg1.${p64}.${s64}.x`, "lg1.!!!.e30", `lg1.${Buffer.from("[]").toString("base64url")}.${s64}`]) assert.equal(readGrant(bad), null, `refused: ${bad}`);

    // --- registering a batch ---
    const register = (grant: string, list: unknown, laptop = "test laptop") =>
      batchesRoute.POST(new Request("http://oracle.test/api/v1/clips/batches", { method: "POST", headers: { authorization: `Grant ${grant}`, "content-type": "application/json" }, body: JSON.stringify({ items: list, laptop }) }));
    assert.equal((await batchesRoute.POST(new Request("http://oracle.test/x", { method: "POST", body: "{}" }))).status, 401, "no grant, no batch");
    assert.equal((await register(g.grant, items.slice(0, 2))).status, 409, "a list other than the signed one is refused");
    assert.equal((await register(g.grant, [...items.slice(0, 2), { ...items[2], sha256: sha("other") }])).status, 409, "a changed sha256 is refused");
    assert.equal((await register(g.grant, [...items, items[0]])).status, 400, "a ref twice is refused");
    assert.equal((await register(`lg1.${p64}.${Buffer.alloc(32).toString("base64url")}`, items)).status, 401, "a forged signature is refused");
    assert.equal((await register(nodeGrant(device.id, "b0b0b0b0b0b0", items, now, `${TOKEN}-other`).grant, items)).status, 401, "a grant signed with another node's token is refused");
    assert.equal((await register(nodeGrant(device.id, "c0c0c0c0c0c0", items, now - 91 * 86400).grant, items)).status, 401, "a grant that has run out is refused");
    const reg = await body(await register(g.grant, items));
    assert.equal(reg.status, 201);
    assert.deepEqual(reg.have, [], "nothing of the batch is on the oracle yet");
    assert.equal((await body(await register(g.grant, items))).status, 200, "registering twice is harmless");

    // --- clips with the grant ---
    const G = `Grant ${g.grant}`;
    const first = await body(await send(G, fields(items[0].ref, { sha256: items[0].sha256 }), sound(1)));
    assert.equal(first.status, 201);
    assert.equal(first.sha256, items[0].sha256, "the oracle echoes the SHA-256 it holds");
    assert.equal((await send(G, fields(items[1].ref), sound(9))).status, 403, "a sound other than the one the node listed is refused");
    assert.equal((await send(G, fields("999@1778728329"), sound(1))).status, 403, "a clip outside the batch is refused");
    assert.equal((await send(G, fields(items[1].ref, { sha256: sha("not this") }), sound(2))).status, 422, "a sound that does not match its own sha256 is refused");
    const again = await body(await send(G, fields(items[0].ref, { sha256: items[0].sha256 }), sound(1)));
    assert.deepEqual([again.status, again.created, again.sha256], [200, false, items[0].sha256], "sent twice: kept once, the same SHA-256 back");
    const row = await prisma.clip.findUniqueOrThrow({ where: { deviceId_detectionRef: { deviceId: device.id, detectionRef: items[0].ref } } });
    assert.deepEqual([row.batch, row.gainDb, row.sha256, row.source], ["a1b2c3d4e5f6", 11.5, items[0].sha256, "AudioMoth"]);

    // --- the node's heartbeat: visit settings and the receipt for the batch ---
    const handed = "a1b2c3d4e5f6:3,zzzzzzzz:5,not a batch!";
    const hb1 = await recordHeartbeat(device.id, { metrics: { visitRev: -1, clipsHanded: handed } });
    assert.ok(hb1.visit, "a node without visit settings gets them");
    assert.equal(hb1.visit!.device, device.id, "with its own device id, for signing grants");
    assert.deepEqual([hb1.visit!.rev, hb1.visit!.ssid, hb1.visit!.psk], [0, "hotspot", "12345678"]);
    assert.match(hb1.visit!.apPsk, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/, "the node's own WiFi gets a password of its own");
    assert.ok(!("clipsReceived" in hb1), "two of three clips: the batch is not complete");
    await send(G, fields(items[1].ref), sound(2));
    // the third arrived earlier over a hotspot with another cut: it does not count until the laptop's sound replaces it
    await send(`Bearer ${TOKEN}`, fields(items[2].ref), sound(33));
    assert.ok(!("clipsReceived" in (await recordHeartbeat(device.id, { metrics: { visitRev: 0, clipsHanded: handed } }))), "a clip with another SHA-256 does not count");
    const kept = await body(await send(G, fields(items[2].ref), sound(3)));
    assert.deepEqual([kept.created, kept.sha256], [false, sha(sound(33))], "the oracle names the sound it has");
    const replaced = await body(await send(G, fields(items[2].ref, { replace: "1" }), sound(3)));
    assert.deepEqual([replaced.replaced, replaced.sha256], [true, items[2].sha256]);
    const hb2 = await recordHeartbeat(device.id, { metrics: { visitRev: 0, clipsHanded: handed } });
    assert.deepEqual(hb2.clipsReceived, ["a1b2c3d4e5f6"], "all three with the listed SHA-256: the node may delete them");
    assert.ok(!("visit" in hb2), "the node has the current settings: none are sent");
    assert.deepEqual((await recordHeartbeat(device.id, { metrics: { clipsHanded: "a1b2c3d4e5f6:3" } })).clipsReceived, ["a1b2c3d4e5f6"], "complete stays complete");
    assert.ok(!("visit" in (await recordHeartbeat(device.id, { metrics: {} }))), "a node without life-visit reports no rev and gets nothing");
    assert.ok(!("clipsReceived" in (await recordHeartbeat(stranger.id, { metrics: { clipsHanded: "a1b2c3d4e5f6:3" } }))), "another node cannot claim the batch");
    assert.deepEqual((await body(await register(g.grant, items))).have.sort(), items.map((i) => i.ref).sort(), "a laptop coming back hears that all are there");

    // --- the node's own token, and two senders at once ---
    const B = `Bearer ${TOKEN}`;
    const direct = await body(await send(B, fields("500@1778730000", { sha256: sha(sound(5)) }), sound(5)));
    assert.deepEqual([direct.status, direct.sha256], [201, sha(sound(5))]);
    assert.equal((await send(`Bearer ${TOKEN}x`, fields("501@1778730000"), sound(6))).status, 401);
    const race = await Promise.all([send(B, fields("502@1778730000"), sound(7)), send(B, fields("502@1778730000"), sound(7))].map(async (r) => body(await r)));
    assert.equal(race.filter((r) => r.created === true).length, 1, "two senders at once: kept once");
    assert.ok(race.every((r) => r.sha256 === sha(sound(7))), "both hear the same SHA-256");
    const old = await prisma.clip.create({ data: { deviceId: device.id, detectionRef: "77", ts: new Date("2026-10-28T08:00:00Z"), scientific: "Turdus merula", confidence: 0.9, file: null } });
    const legacy = await body(await send(B, fields("77"), sound(8)));
    assert.deepEqual([legacy.created, legacy.sha256], [false, null], "a clip from before SHA-256s answers null, so the node sends it again with replace");
    assert.equal((await body(await send(B, fields("77", { replace: "1" }), sound(8)))).sha256, sha(sound(8)));
    assert.equal((await prisma.clip.findUniqueOrThrow({ where: { id: old.id } })).sha256, sha(sound(8)));

    // --- the heartbeat's shape ---
    const mics = { day: "2026-11-02", n: 40, bands: [250, 500, 1000], diff: [30, 35.5, null], missing: ["i2s"], at: "2026-11-02T10:00:00Z" };
    assert.ok(HeartbeatIn.safeParse({ metrics: { battV: 12.9, mics, clipsHanded: "a:1", visitRev: 2, clipsFull: true } }).success, "the microphones' check rides along");
    assert.ok(!HeartbeatIn.safeParse({ metrics: { deep: { a: { b: 1 } } } }).success, "two levels deep is refused");
    assert.ok(!HeartbeatIn.safeParse({ metrics: { big: "x".repeat(17_000) } }).success, "over 16 kB is refused");
    const post = (b: unknown) => soundRoute.POST(new Request("http://oracle.test/api/v1/ingest/sound", { method: "POST", headers: { authorization: B, "content-type": "application/json" }, body: JSON.stringify(b) }));
    const det = { ts: "2026-11-02T07:01:00+01:00", species: "Merel", scientific: "Turdus merula", confidence: 0.91 };
    const withMics = await body(await post({ detections: [det], heartbeat: { event: "hourly", metrics: { mics, visitRev: 0 } } }));
    assert.deepEqual([withMics.status, withMics.detections, typeof withMics.heartbeat], [201, 1, "object"], "a sound post with the microphones' check is stored");
    const unreadable = await body(await post({ detections: [det], heartbeat: { event: "hourly", metrics: { deep: { a: { b: 1 } } } } }));
    assert.deepEqual([unreadable.status, unreadable.detections, unreadable.heartbeat], [201, 1, undefined], "a heartbeat the oracle cannot read costs the detections nothing");
    assert.ok(Array.isArray(unreadable.heartbeatError));

    // --- the owner's visit settings and alarm window (a managing key here; a signed-in owner the same way) ---
    const ctx = { params: Promise.resolve({ id: place.id, deviceId: device.id }) };
    const asAdmin = (method: string, b?: unknown) => new Request("http://oracle.test/x", { method, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    assert.equal((await visitRoute.GET(new Request("http://oracle.test/x"), ctx)).status, 401, "nobody signed in: no settings");
    assert.equal((await visitRoute.GET(new Request("http://oracle.test/x", { headers: { authorization: B } }), ctx)).status, 401, "the node's own token does not manage the place");
    const v0 = await body(await visitRoute.GET(asAdmin("GET"), ctx));
    assert.deepEqual([v0.ssid, v0.psk, v0.apPsk, v0.rev, v0.nodeHas], ["hotspot", "12345678", hb1.visit!.apPsk, 0, true]);
    const v1 = await body(await visitRoute.PUT(asAdmin("PUT", { ssid: "iPhone van Sven", psk: "veldwerk-2026" }), ctx));
    assert.deepEqual([v1.status, v1.ssid, v1.psk, v1.rev, v1.nodeHas], [200, "iPhone van Sven", "veldwerk-2026", 1, false], "set, and the node does not have it yet");
    for (const bad of [{ psk: "1234567" }, { psk: "x".repeat(64) }, { psk: "wachtwoordé1" }, { ssid: "x".repeat(33) }, { ssid: "é".repeat(17) }, { ssid: "" }, {}]) {
      assert.equal((await visitRoute.PUT(asAdmin("PUT", bad), ctx)).status, 400, `refused: ${JSON.stringify(bad)}`);
    }
    const sent = await recordHeartbeat(device.id, { metrics: { visitRev: 0 } });
    assert.deepEqual([sent.visit?.rev, sent.visit?.ssid, sent.visit?.psk], [1, "iPhone van Sven", "veldwerk-2026"], "the node hears the change");
    const v2 = await body(await visitRoute.PUT(asAdmin("PUT", { ssid: null, apPsk: null }), ctx));
    assert.deepEqual([v2.ssid, v2.psk, v2.rev], ["hotspot", "veldwerk-2026", 2], "null puts the default back");
    assert.notEqual(v2.apPsk, hb1.visit!.apPsk, "a new password for the node's own WiFi");
    const otherCtx = { params: Promise.resolve({ id: place.id, deviceId: stranger.id }) };
    assert.equal((await visitRoute.GET(asAdmin("GET"), otherCtx)).status, 404, "a device of another place is not found under this one");
    const m = await body(await maintenanceRoute.PUT(asAdmin("PUT", { hours: 4 }), ctx));
    assert.equal(m.maintenance.active, true);
    assert.equal((await body(await visitRoute.GET(asAdmin("GET"), ctx))).maintenance !== null, true, "the alarm window shows on the owner's panel");
    assert.equal((await maintenanceRoute.DELETE(asAdmin("DELETE"), ctx)).status, 200);

    // --- the download ---
    const zctx = { params: Promise.resolve({ id: place.id }) };
    assert.equal((await zipRoute.GET(new Request("http://oracle.test/x"), zctx)).status, 404, "nobody signed in: no clips of a private place");
    const zr = await zipRoute.GET(new Request("http://oracle.test/x?month=2026-05", { headers: { authorization: `Bearer ${ADMIN}` } }), zctx);
    assert.equal(zr.status, 200);
    assert.equal(zr.headers.get("content-type"), "application/zip");
    const zfile = path.join(tmp, "may.zip");
    writeFileSync(zfile, Buffer.from(await zr.arrayBuffer()));
    const check = (file: string, expectCsv: boolean) => {
      const py = [
        "import csv, io, json, sys, zipfile",
        "z = zipfile.ZipFile(sys.argv[1]); bad = z.testzip(); names = z.namelist()",
        "rows = list(csv.DictReader(io.StringIO(z.read('clips.csv').decode()))) if 'clips.csv' in names else []",
        "print(json.dumps({'bad': bad, 'n': len(names), 'names': names[:3], 'rows': rows[:20]}))",
      ].join("\n");
      const r = spawnSync("python3", ["-I", "-c", py, file], { encoding: "utf8", maxBuffer: 64 << 20 });
      if (r.status !== 0) throw new Error(r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.bad, null, "every file in the zip reads back with its CRC");
      if (expectCsv) assert.ok(out.rows.length > 0);
      return out;
    };
    const may = check(zfile, true);
    assert.equal(may.n, 6, "the five clips of May with sound, and clips.csv");
    const r0 = may.rows.find((r: Record<string, string>) => r.detection === items[0].ref);
    assert.deepEqual([r0.scientific, r0.band, r0.sha256, r0.gain_db], ["Limosa limosa", "0.8", items[0].sha256, "11.5"]);
    assert.equal((await zipRoute.GET(new Request("http://oracle.test/x?month=2026-04", { headers: { authorization: `Bearer ${ADMIN}` } }), zctx)).status, 404, "an empty month");
    assert.equal((await zipRoute.GET(new Request("http://oracle.test/x?month=2026-13", { headers: { authorization: `Bearer ${ADMIN}` } }), zctx)).status, 400);

    // a zip past the classic format's 65,535 files carries the ZIP64 records
    const many = path.join(tmp, "many.zip");
    const files = Array.from({ length: 66_000 }, (_, k) => ({ name: `f${k}.txt`, time: new Date("2026-11-02T10:00:00Z"), data: async () => Buffer.from(String(k % 10)) }));
    writeFileSync(many, Buffer.from(await new Response(zipStream(files)).arrayBuffer()));
    assert.equal(check(many, false).n, 66_000, "ZIP64: all 66,000 files are listed");

    // --- how long the oracle keeps a place's sound ---
    const ago = (d: number) => new Date(Date.now() - d * 86400e3);
    await prisma.clip.updateMany({ where: { deviceId: device.id }, data: { createdAt: ago(10) } });
    await prisma.place.update({ where: { id: place.id }, data: { clipKeepDays: 0 } });
    await pruneClips();
    assert.equal(await prisma.clip.count({ where: { deviceId: device.id, file: null } }), 0, "0 keeps the sound for as long as the place exists");
    await prisma.place.update({ where: { id: place.id }, data: { clipKeepDays: null } });
    await pruneClips();
    assert.equal(await prisma.clip.count({ where: { deviceId: device.id, file: null } }), 0, "ten days is inside the default thirty");
    await prisma.place.update({ where: { id: place.id }, data: { clipKeepDays: 7 } });
    await pruneClips();
    assert.equal(await prisma.clip.count({ where: { deviceId: device.id, file: { not: null } } }), 0, "seven days: the sound of clips ten days old is gone");
    assert.ok((await prisma.clip.count({ where: { deviceId: device.id } })) > 0, "the rows stay, for the thresholds");

    console.log("clips:test ok");
  } finally {
    await prisma.place.deleteMany({ where: { id: { in: [place.id, other.id] } } });
    await prisma.$disconnect();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
