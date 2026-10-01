import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import * as turf from "@turf/turf";
import { prisma } from "./db";
import { hashKey, newKey } from "./auth";
import { slugify, summarize } from "./geo";
import { queueJob, uniqueSlug } from "./places";
import { DEFAULT_BLUR_M, reblur } from "./privacy";
import type { PlaceGeometry } from "./geo";

// A personal Life Box image, made in about half a minute instead of recompressing 9 GiB per box.
// The golden image is kept split at the start of the root partition (sector 1064960): the part before it
// (partition table + FAT boot partition) as a raw file, the rest compressed once. Per box, the boot part gets
// the box's life-node.env written into its FAT with mtools and is compressed alone; the download is the two
// xz streams back to back, which xz and Raspberry Pi Imager (libarchive) decompress as one image.
//   IMAGE_DIR/golden/head.img   first 1064960 sectors of the golden image, raw
//   IMAGE_DIR/golden/tail.xz    everything after, xz
//   IMAGE_DIR/golden/VERSION    one line, e.g. "2026-10-01 b3ee6c00"
//   IMAGE_DIR/boxes/<id>.head.xz
const DIR = process.env.IMAGE_DIR ?? "/images";
const FAT_OFFSET = 16384 * 512;
// where an unplaced box listens for birds: the middle of the Netherlands, until it is placed
const DEFAULT_LAT = 52.1, DEFAULT_LON = 5.3;

const golden = (f: string) => path.join(DIR, "golden", f);
const boxHead = (id: string) => path.join(DIR, "boxes", `${id}.head.xz`);

export async function goldenVersion(): Promise<string | null> {
  try { return (await readFile(golden("VERSION"), "utf8")).trim(); } catch { return null; }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}: ${err.slice(0, 300)}`))));
  });
}

/** WiFi names and passwords go into the env file in single quotes; refuse what cannot be quoted that way. */
export function checkWifi(ssid: string, psk: string): string | null {
  if (/['\n\r\\]/.test(ssid + psk)) return "The WiFi name or password contains a quote, backslash or line break, which the box cannot read. Is there another network?";
  if (ssid && Buffer.byteLength(ssid) > 32) return "That WiFi name is longer than WiFi allows (32 characters).";
  if (psk && (psk.length < 8 || psk.length > 63)) return "A WiFi password has 8 to 63 characters. Check it, or leave it empty for an open network.";
  return null;
}

function envFile(o: { hostname: string; password: string; lat: number; lon: number; tokens: [string, string, string]; ssid?: string; psk?: string }) {
  const api = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://life.oncra.org").replace(/\/$/, "")}/api/v1`;
  const wifi = !!o.ssid;
  return [
    `# life-node.env, written by ${api.replace("/api/v1", "")}/box for ${o.hostname} on ${new Date().toISOString().slice(0, 10)}`,
    `NODE_HOSTNAME=${o.hostname}`,
    `NODE_PASSWORD='${o.password}'`,
    `NODE_LAT=${o.lat}`,
    `NODE_LON=${o.lon}`,
    `LIFE_API=${api}`,
    `LIFE_DEVICE_TOKEN=${o.tokens[0]}`,
    `LIFE_DEVICE_TOKEN_SOIL_1=${o.tokens[1]}`,
    `LIFE_DEVICE_TOKEN_SOIL_2=${o.tokens[2]}`,
    `RS485_PORT=/dev/ttyUSB0`,
    `PROBE_ADDRESSES=1,2`,
    `PROBE_PROFILE=sen0600`,
    // on the desk every reading is posted at once, so the box page shows it within minutes; in the field, hourly to spare the SIM
    `LIFE_POST_BATCH=${wifi ? 1 : 3}`,
    `LIFE_MIN_CONFIDENCE=0.5`,
    // a box on WiFi is on a desk being tried out: awake 15 minutes in every hour; without WiFi it is in the field
    `SCHEDULE=${wifi ? "bench" : "season"}`,
    `WIFI_SSID=${wifi ? `'${o.ssid}'` : ""}`,
    `WIFI_PSK=${wifi && o.psk ? `'${o.psk}'` : ""}`,
    `WIFI_COUNTRY=NL`,
    `MODEM_HOST=192.168.8.1`,
    `NODE_TZ=Europe/Amsterdam`,
    `GUARD=0`,
    "",
  ].join("\n");
}

function square(lat: number, lon: number, halfM = 50): PlaceGeometry {
  const dLat = halfM / 111_320, dLon = halfM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { type: "Polygon", coordinates: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]] };
}

const WORDS = ["lark", "oak", "moss", "fern", "wren", "beech", "clover", "otter", "heron", "willow", "thrush", "aspen", "finch", "hazel", "linden", "sedge"];
async function newHostname(): Promise<string> {
  for (;;) {
    const h = `lifebox-${WORDS[randomBytes(1)[0] % WORDS.length]}-${String(randomBytes(2).readUInt16BE() % 100).padStart(2, "0")}`;
    if (!(await prisma.box.findUnique({ where: { hostname: h } }))) return h;
  }
}

/** The devices of one box. A place can carry more than one box (and devices registered by hand), so a box's own
 * three are the ones created with its hostname in the notes. */
export const boxDeviceNote = (hostname: string) => `Life Box ${hostname}`;

/** A new box with its three devices and the box row. Without `placeId` the box gets a private, unplaced place of its
 * own; with it, the box is set up for that existing place (the caller checks the person may). The image is built after. */
export async function createBox(userId: string, name: string, placeId?: string) {
  const hostname = await newHostname();
  let place;
  if (placeId) {
    place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
  } else {
    const geometry = square(DEFAULT_LAT, DEFAULT_LON);
    const s = summarize(geometry);
    place = await prisma.place.create({
      data: { name, slug: await uniqueSlug(slugify(`${name}-${hostname}`)), geometry: geometry as object, areaHa: s.areaHa, centroidLat: s.centroidLat, centroidLon: s.centroidLon, public: false, placed: false, landUse: "not yet placed", locationHidden: true, blurRadiusM: DEFAULT_BLUR_M },
    });
  }
  const devices = [
    { kind: "SOUND" as const, model: "Life node v1, BirdNET-Go on Raspberry Pi 4, INMP441", heightM: 0.5 },
    { kind: "SOIL" as const, model: "DFRobot SEN0600", depthCm: 10 },
    { kind: "SOIL" as const, model: "DFRobot SEN0600", depthCm: 30 },
  ];
  // token hashes are placeholders until the image is built; buildImage mints the real tokens
  for (const d of devices) await prisma.device.create({ data: { ...d, placeId: place.id, tokenHash: hashKey(newKey("lo_dev")), notes: boxDeviceNote(hostname) } });
  return prisma.box.create({ data: { userId, placeId: place.id, name, hostname, nodePassword: randomBytes(6).toString("base64url"), imageStatus: "BUILDING", ownPlace: !placeId } });
}

/** Mints fresh device tokens (so an older image of this box stops working) and writes the box's image. */
export async function buildImage(boxId: string, wifi: { ssid?: string; psk?: string }) {
  const box = await prisma.box.findUniqueOrThrow({ where: { id: boxId }, include: { place: { include: { devices: { orderBy: [{ kind: "asc" }, { depthCm: "asc" }] } } } } });
  const work = path.join(DIR, "work", `${box.id}-${randomBytes(3).toString("hex")}`);
  try {
    const version = await goldenVersion();
    if (!version) throw new Error("the golden image is not on this server yet");
    const mine = box.place.devices.filter((d) => d.notes === boxDeviceNote(box.hostname));
    const sound = mine.find((d) => d.kind === "SOUND");
    const soil = mine.filter((d) => d.kind === "SOIL");
    if (!sound || soil.length < 2) throw new Error("this box is missing its devices");
    const tokens: [string, string, string] = [newKey("lo_dev"), newKey("lo_dev"), newKey("lo_dev")];
    await mkdir(work, { recursive: true });
    await mkdir(path.join(DIR, "boxes"), { recursive: true });
    const img = path.join(work, "head.img"), env = path.join(work, "life-node.env"), xz = path.join(work, "head.img.xz");
    // a box set up for an existing place listens for that place's birds from the start
    const known = box.placedAt || box.place.placed;
    const lat = known ? box.place.centroidLat : DEFAULT_LAT, lon = known ? box.place.centroidLon : DEFAULT_LON;
    await writeFile(env, envFile({ hostname: box.hostname, password: box.nodePassword, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, tokens, ssid: wifi.ssid, psk: wifi.psk }), { mode: 0o600 });
    await run("cp", ["--sparse=always", golden("head.img"), img]);
    await run("mcopy", ["-o", "-i", `${img}@@${FAT_OFFSET}`, env, "::life-node.env"]);
    await run("xz", ["-T0", "-1", "-k", img]);
    // tokens go live only once the image that carries them exists
    await prisma.$transaction([
      prisma.device.update({ where: { id: sound.id }, data: { tokenHash: hashKey(tokens[0]) } }),
      prisma.device.update({ where: { id: soil[0].id }, data: { tokenHash: hashKey(tokens[1]) } }),
      prisma.device.update({ where: { id: soil[1].id }, data: { tokenHash: hashKey(tokens[2]) } }),
    ]);
    await rename(xz, boxHead(box.id));
    const bytes = (await stat(boxHead(box.id))).size + (await stat(golden("tail.xz"))).size;
    await prisma.box.update({ where: { id: box.id }, data: { imageStatus: "READY", imageError: null, imageVersion: version, imageBytes: BigInt(bytes), builtAt: new Date(), wifiSsid: wifi.ssid || null } });
  } catch (e) {
    console.error(`box image ${boxId}:`, e);
    await prisma.box.update({ where: { id: boxId }, data: { imageStatus: "FAILED", imageError: String((e as Error).message).slice(0, 300) } });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The download: the box's own boot part followed by the shared rest, as one .img.xz. */
export async function imageStream(boxId: string): Promise<{ stream: ReadableStream; bytes: number }> {
  const parts = [boxHead(boxId), golden("tail.xz")];
  let bytes = 0;
  for (const p of parts) bytes += (await stat(p)).size;
  const out = new PassThrough();
  (async () => {
    for (const p of parts) {
      await new Promise<void>((res, rej) => { const s = createReadStream(p); s.on("end", res); s.on("error", rej); s.pipe(out, { end: false }); });
    }
    out.end();
  })().catch((e) => out.destroy(e));
  return { stream: Readable.toWeb(out) as unknown as ReadableStream, bytes };
}

/** Put the box on the map where it now stands. A box with its own place: a 1 ha square around the point, and the
 * satellite starts. A box on an existing place: the point must be on (or within 200 m of) that place, the boundary
 * stays, and only the box's devices get the position. Returns an error text for the person, or null. */
export async function placeBox(boxId: string, lat: number, lon: number): Promise<string | null> {
  const box = await prisma.box.findUniqueOrThrow({ where: { id: boxId }, include: { place: true } });
  if (!box.ownPlace) {
    const near = turf.booleanPointInPolygon(turf.point([lon, lat]), turf.buffer(box.place.geometry as unknown as PlaceGeometry, 0.2, { units: "kilometers" })!);
    if (!near) return `That spot is not on ${box.place.name}. Stand next to the box, or check the numbers you typed.`;
    await prisma.device.updateMany({ where: { placeId: box.placeId, notes: boxDeviceNote(box.hostname) }, data: { lat, lon, installedAt: new Date() } });
    await prisma.box.update({ where: { id: boxId }, data: { placedAt: new Date() } });
    return null;
  }
  const geometry = square(lat, lon);
  const s = summarize(geometry);
  await prisma.place.update({ where: { id: box.placeId }, data: { geometry: geometry as object, areaHa: s.areaHa, centroidLat: s.centroidLat, centroidLon: s.centroidLon, placed: true, landUse: null } });
  await reblur(box.placeId); // a box sits at someone's home: the public sees a circle, drawn around the new spot
  await prisma.device.updateMany({ where: { placeId: box.placeId }, data: { lat, lon, installedAt: new Date() } });
  await prisma.box.update({ where: { id: boxId }, data: { placedAt: new Date() } });
  await queueJob("context.enrich", box.placeId);
  await queueJob("satellite.backfill", box.placeId);
  return null;
}
