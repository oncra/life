import { createHash } from "node:crypto";
import path from "node:path";
import { prisma } from "@/lib/db";
import { authenticate, json } from "@/lib/auth";
import { CLIP_MAX_BYTES, clipSender, dropClipFile, mimeOf, pruneClips, saveClipFile } from "@/lib/clips";
export const dynamic = "force-dynamic";

// One detection's clip for /triage, as multipart: the sound (`file`) and the fields of its row in the node's clips.csv
// (detection, time_utc, scientific, score, band, detector, clip_s, detection_from_s, detection_to_s), plus species and
// source (the microphone) when known, and `expansion` when the sound is slowed down (a bat clip, ten times). Sent by
// clients/clips-upload.py from a computer at a bench node, with the node's own token, or with an admin or steward key
// and `device`. The same detection sent twice is kept once; with `replace=1` the second sound takes the first one's
// place and the verdicts stay, for a clip that was first sent in a form nobody could judge.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "send multipart/form-data" }, 400);
  const text = (...keys: string[]) => {
    for (const k of keys) {
      const v = form.get(k);
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const num = (...keys: string[]) => {
    const v = text(...keys);
    return v === null || !Number.isFinite(Number(v)) ? null : Number(v);
  };
  const who = await clipSender(req, text("device"));
  if (who instanceof Response) return who;
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "file is missing" }, 400);
  if (file.size === 0 || file.size > CLIP_MAX_BYTES) return json({ error: `a clip is 1 to ${CLIP_MAX_BYTES} bytes` }, 413);
  const mime = mimeOf(file.name);
  if (!mime) return json({ error: "send m4a, mp3, wav, flac, ogg or opus" }, 415);
  const ref = text("detection");
  const ts = new Date(text("time_utc") ?? "");
  const scientific = text("scientific");
  const confidence = num("score", "confidence");
  if (!ref || Number.isNaN(ts.getTime()) || !scientific || confidence === null || confidence < 0 || confidence > 1) {
    return json({ error: "detection, time_utc, scientific and score are needed" }, 400);
  }
  const x = num("expansion");
  const expansion = x !== null && Number.isInteger(x) && x > 1 && x <= 100 ? x : null;
  const deviceId = who.deviceId;
  const have = await prisma.clip.findUnique({ where: { deviceId_detectionRef: { deviceId, detectionRef: ref } }, select: { id: true, file: true } });
  const replace = text("replace") === "1";
  if (have && !replace) return json({ ok: true, id: have.id, created: false });
  const data = Buffer.from(await file.arrayBuffer());
  const name = `${deviceId}/${createHash("sha256").update(data).digest("hex").slice(0, 32)}${path.extname(file.name).toLowerCase()}`;
  await saveClipFile(name, data);
  if (have) {
    await prisma.clip.update({ where: { id: have.id }, data: { file: name, mime, bytes: data.length, expansion } });
    if (have.file && have.file !== name) await dropClipFile(have.file);
    return json({ ok: true, id: have.id, created: false, replaced: true });
  }
  const clip = await prisma.clip.create({
    data: {
      deviceId, detectionRef: ref, ts, scientific: scientific.slice(0, 120), species: text("species")?.slice(0, 120) ?? null, confidence,
      band: text("band")?.slice(0, 8) ?? null, detector: text("detector")?.slice(0, 80) ?? null, source: text("source")?.slice(0, 80) ?? null,
      clipS: num("clip_s"), fromS: num("detection_from_s", "from_s"), toS: num("detection_to_s", "to_s"), file: name, mime, bytes: data.length, expansion,
    },
  });
  pruneClips().catch(() => {});
  return json({ ok: true, id: clip.id, created: true }, 201);
}

// Every clip with its verdicts and without its sound, and the band weights, for fitting the per-species thresholds.
// Admin key only.
export async function GET(req: Request) {
  const p = await authenticate(req);
  if (p?.kind !== "admin" && !(p?.kind === "key" && p.role === "ADMIN")) return json({ error: "the admin key is needed" }, 401);
  const device = new URL(req.url).searchParams.get("device") ?? undefined;
  const [clips, bands] = await Promise.all([
    prisma.clip.findMany({
      where: device ? { deviceId: device } : {},
      orderBy: { ts: "asc" },
      select: {
        id: true, deviceId: true, detectionRef: true, ts: true, scientific: true, species: true, confidence: true, band: true, detector: true, source: true, file: true,
        reviews: { select: { verdict: true, actual: true, note: true, updatedAt: true, user: { select: { email: true } } } },
      },
    }),
    prisma.clipBand.findMany({ where: device ? { deviceId: device } : {} }),
  ]);
  return json({ clips: clips.map(({ file, ...c }) => ({ ...c, hasSound: file !== null })), bands });
}
