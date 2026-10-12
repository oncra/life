// Cut-out pictures of the species the recorders hear, for the node dashboard. Once per species the worker looks the
// species up on Wikipedia (by scientific name, then by the name the detector gave), takes the article's lead photo
// from Wikimedia Commons together with its author and licence, removes the background with U²-Net (Qin et al. 2020,
// Apache-2.0; the ONNX file published by the rembg project) run through onnxruntime, and stores the PNG with its
// credits in `SpeciesImage`. Nothing runs while someone looks at the page: it serves the stored PNG.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "./db";

const UA = "LifeOracle/0.1 (https://life.oncra.org; life@oncra.org)";
const MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx";
const MODEL_SHA256 = "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491";
/** U²-Net takes a 320 by 320 picture */
const SIZE = 320;
/** longest side of the stored cut-out */
const OUT_MAX = 720;

export type Photo = { title: string; file: string; fileUrl: string; imageUrl: string; author: string | null; license: string | null; licenseUrl: string | null };

async function getJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json() as Promise<Record<string, unknown>>;
}
const stripHtml = (h: unknown) => (typeof h === "string" ? h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || null : null);

/** The lead photo of the species' English Wikipedia article, with its Commons credits. The scientific name first:
 * it is unambiguous, where a common name may land on a disambiguation page. */
export async function findPhoto(scientific: string | null, species: string): Promise<Photo | null> {
  const names = [...new Set([scientific, species].map((s) => s?.trim()).filter((s): s is string => !!s))];
  for (const name of names) {
    let s: Record<string, unknown>;
    try { s = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`); } catch { continue; }
    if (s.type === "disambiguation") continue;
    const orig = (s.originalimage as { source?: string } | undefined)?.source;
    if (!orig) continue;
    // .../commons/thumb/3/33/File.jpg/3840px-File.jpg  or  .../commons/3/33/File.jpg
    const m = /\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/.exec(orig);
    if (!m) continue;
    const file = decodeURIComponent(m[1]);
    if (/\.(svg|gif|ogg|ogv|webm|pdf|tif|tiff)$/i.test(file)) continue;
    const meta = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata%7Curl&iiurlwidth=900&titles=${encodeURIComponent(`File:${file}`)}`);
    const pages = (meta.query as { pages?: Record<string, { imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[] }> } | undefined)?.pages ?? {};
    const info = Object.values(pages)[0]?.imageinfo?.[0];
    if (!info?.url) continue;
    const ext = info.extmetadata ?? {};
    return {
      title: String(s.title ?? name), file, fileUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`, imageUrl: info.thumburl ?? info.url,
      author: stripHtml(ext.Artist?.value), license: stripHtml(ext.LicenseShortName?.value), licenseUrl: ext.LicenseUrl?.value ?? null,
    };
  }
  return null;
}

function modelPath() {
  return path.join(process.env.IMAGE_DIR ?? path.join(process.cwd(), "images"), "models", "u2net.onnx");
}

/** The model file on disk (IMAGE_DIR/models/u2net.onnx, 176 MB), fetched once and checked against its hash. */
export async function ensureModel(log: (s: string) => void = () => {}): Promise<string> {
  const p = modelPath();
  if (fs.existsSync(p) && fs.statSync(p).size > 100e6) return p;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  log(`fetching U²-Net from ${MODEL_URL}`);
  const r = await fetch(MODEL_URL, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`model download: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== MODEL_SHA256) throw new Error(`model hash mismatch: ${sha}`);
  fs.writeFileSync(`${p}.part`, buf);
  fs.renameSync(`${p}.part`, p);
  return p;
}

type Session = { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>; inputNames: string[]; outputNames: string[] };
let session: Session | null = null;
let Tensor: (new (type: string, data: Float32Array, dims: number[]) => unknown) | null = null;
async function getSession(log: (s: string) => void) {
  if (session) return session;
  const ort = await import("onnxruntime-node");
  Tensor = ort.Tensor as unknown as typeof Tensor;
  session = (await ort.InferenceSession.create(await ensureModel(log), { intraOpNumThreads: 2 })) as unknown as Session;
  return session;
}
/** Lets the model go after a sweep: the worker should not keep a few hundred MB around between them. */
export function releaseModel() { session = null; }

/** The subject of a photo on a transparent ground, cropped to it. `coverage` is the share of the picture it filled. */
export async function cutOut(input: Buffer, log: (s: string) => void = () => {}): Promise<{ webp: Buffer; width: number; height: number; coverage: number }> {
  const photo = await sharp(input).rotate().resize({ width: OUT_MAX, height: OUT_MAX, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const W = photo.info.width, H = photo.info.height;
  if (photo.info.channels !== 3) throw new Error(`expected 3 channels, got ${photo.info.channels}`);
  const small = await sharp(photo.data, { raw: { width: W, height: H, channels: 3 } }).resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  let max = 1;
  for (const v of small) if (v > max) max = v;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const f = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) f[c * SIZE * SIZE + i] = (small[i * 3 + c] / max - mean[c]) / std[c];
  const s = await getSession(log);
  const out = await s.run({ [s.inputNames[0]]: new Tensor!("float32", f, [1, 3, SIZE, SIZE]) });
  const pred = out[s.outputNames[0]].data;
  let mi = Infinity, ma = -Infinity;
  for (let i = 0; i < SIZE * SIZE; i++) { if (pred[i] < mi) mi = pred[i]; if (pred[i] > ma) ma = pred[i]; }
  // 0..1, then a soft threshold so haze goes and the edge stays feathered
  const m8 = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = (pred[i] - mi) / (ma - mi || 1);
    const t = Math.max(0, Math.min(1, (v - 0.15) / 0.6));
    m8[i] = Math.round(255 * t * t * (3 - 2 * t));
  }
  // sharp may hand the scaled mask back with three channels; keep one byte per pixel whatever it does
  const scaled = await sharp(m8, { raw: { width: SIZE, height: SIZE, channels: 1 } }).resize(W, H, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  const ch = scaled.info.channels;
  const mask = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = scaled.data[i * ch];
  let x0 = W, y0 = H, x1 = -1, y1 = -1, on = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x] > 64) { on++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  log(`cut-out: ${W}x${H}, model output ${mi.toFixed(3)}..${ma.toFixed(3)}, subject ${((on / (W * H)) * 100).toFixed(1)}% of the photo`);
  if (x1 < 0) throw new Error("no subject found in the photo");
  const pad = Math.round(Math.max(W, H) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  // the photo with the mask as its alpha, built by hand: sharp's joinChannel reads a fourth channel as CMYK
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = photo.data[i * 3]; rgba[i * 4 + 1] = photo.data[i * 3 + 1]; rgba[i * 4 + 2] = photo.data[i * 3 + 2]; rgba[i * 4 + 3] = mask[i]; }
  const webp = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .webp({ quality: 82, alphaQuality: 90, effort: 5 })
    .toBuffer();
  return { webp, width: x1 - x0 + 1, height: y1 - y0 + 1, coverage: on / (W * H) };
}

/** Look one species up, cut its photo out and store it; a failure is stored too, so it is not retried every hour. */
export async function makeSpeciesImage(species: string, scientific: string | null, log: (s: string) => void = () => {}) {
  const row = await prisma.speciesImage.upsert({ where: { species }, create: { species, scientific, status: "pending" }, update: { status: "pending", error: null } });
  try {
    const photo = await findPhoto(scientific, species);
    if (!photo) throw new Error("no Wikipedia article with a photo");
    const r = await fetch(photo.imageUrl, { headers: { "user-agent": UA } });
    if (!r.ok) throw new Error(`photo download: ${r.status}`);
    const cut = await cutOut(Buffer.from(await r.arrayBuffer()), log);
    if (cut.coverage < 0.015) throw new Error(`subject too small to cut out (${(cut.coverage * 100).toFixed(1)}% of the photo)`);
    await prisma.speciesImage.update({ where: { id: row.id }, data: { status: "ready", scientific: scientific ?? row.scientific, title: photo.title, sourceUrl: photo.fileUrl, author: photo.author, license: photo.license, licenseUrl: photo.licenseUrl, image: new Uint8Array(cut.webp), width: cut.width, height: cut.height, error: null } });
    log(`species image: ${species} from ${photo.file} (${photo.license ?? "licence unknown"}), ${Math.round(cut.webp.length / 1024)} kB`);
    return true;
  } catch (e) {
    await prisma.speciesImage.update({ where: { id: row.id }, data: { status: "failed", error: String((e as Error).message ?? e).slice(0, 500) } });
    log(`species image: ${species} failed: ${String((e as Error).message ?? e).slice(0, 160)}`);
    return false;
  }
}

/** Species heard anywhere that have no picture yet (a failure is tried again after thirty days), newest first. */
export async function speciesImageSweep(log: (s: string) => void = () => {}, limit = 40): Promise<number> {
  const todo = await prisma.$queryRaw<{ species: string; scientific: string | null }[]>`
    select d.species, max(d.scientific) as scientific from "SoundDetection" d
    left join "SpeciesImage" i on i.species = d.species
    where i.id is null or (i.status = 'failed' and i."updatedAt" < now() - interval '30 days')
    group by d.species order by max(d.ts) desc limit ${limit}`;
  let made = 0;
  for (const t of todo) if (await makeSpeciesImage(t.species, t.scientific, log)) made++;
  if (todo.length) releaseModel();
  return made;
}
