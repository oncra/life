import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "./db";
import { authenticate, canManagePlace, forbidden, json, unauthorized } from "./auth";
import { canSeeExact } from "./privacy";

// Clips of detections, for checking by ear whether the detector was right (/triage). Only from a node on the bench,
// by its steward's choice: in a field a node keeps no sound (node/life-clips.py). The files live under CLIP_DIR, beside
// the box images on the host so they survive a redeploy; the database keeps each clip's facts and the verdicts on it.
// A clip's sound is deleted after CLIP_KEEP_DAYS; its row and the verdicts stay, for the per-species thresholds.

export const CLIP_DIR = process.env.CLIP_DIR ?? path.join(process.env.IMAGE_DIR ?? path.join(process.cwd(), "images"), "clips");
export const CLIP_KEEP_DAYS = Number(process.env.CLIP_KEEP_DAYS ?? 30);
export const CLIP_MAX_BYTES = 8 * 1024 * 1024;
export const VERDICTS = ["right", "wrong", "unsure"] as const;
export type Verdict = (typeof VERDICTS)[number];

const MIME: Record<string, string> = {
  m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg",
};

export function mimeOf(name: string): string | null {
  return MIME[path.extname(name).slice(1).toLowerCase()] ?? null;
}

/** Who may send a device's clips: the node itself (its token), an admin, or a key that manages the device's place. */
export async function clipSender(req: Request, deviceField: string | null): Promise<{ deviceId: string } | Response> {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  const deviceId = p.kind === "device" ? p.id : deviceField;
  if (!deviceId) return json({ error: "name the device (device)" }, 400);
  const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, placeId: true } });
  if (!d) return json({ error: "unknown device" }, 404);
  if (p.kind !== "device" && !canManagePlace(p, d.placeId)) return forbidden();
  return { deviceId: d.id };
}

export const ReviewBody = z.object({
  verdict: z.enum(VERDICTS).nullable(),
  actual: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

/** A file name under CLIP_DIR, resolved; anything that would leave the folder is refused. */
export function clipPath(file: string): string {
  const root = path.resolve(CLIP_DIR);
  const p = path.resolve(root, file);
  if (!p.startsWith(root + path.sep)) throw new Error("clip path outside CLIP_DIR");
  return p;
}

export async function saveClipFile(name: string, data: Buffer) {
  const p = clipPath(name);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}

/** Whoever may see a device's place exactly may hear its clips: admins, the place's steward key, its owner, people given access. */
export async function mayHear(deviceId: string, req?: Request): Promise<boolean> {
  const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { placeId: true } });
  return d ? canSeeExact({ id: d.placeId }, req) : false;
}

/** Deletes the sound of clips older than CLIP_KEEP_DAYS. Their rows and the verdicts on them stay. */
export async function pruneClips(now = new Date()): Promise<number> {
  const old = await prisma.clip.findMany({
    where: { file: { not: null }, createdAt: { lt: new Date(now.getTime() - CLIP_KEEP_DAYS * 86400e3) } },
    select: { id: true, file: true },
    take: 500,
  });
  for (const c of old) {
    if (c.file) await rm(clipPath(c.file), { force: true }).catch(() => {});
    await prisma.clip.update({ where: { id: c.id }, data: { file: null } });
  }
  return old.length;
}
