import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";

// The research archive. The oracle keeps a clip's sound for triage (CLIP_KEEP_DAYS, src/lib/clips.ts); research wants
// more than a month, and keeping everything on the oracle's own disk costs about 18 times what a Storage Box does. So a
// clip worth keeping is copied to the archive first, and the oracle deletes its sound only once that copy is made or the
// clip was judged not worth keeping. Worth keeping (decided 12 November 2026):
//   - every clip scored ARCHIVE_MIN_SCORE (0.5) or more: what a researcher would listen to;
//   - every clip someone has judged: the calibration set (these also stay on the oracle for good, see pruneClips);
//   - below that, at most ARCHIVE_PER_BAND (5) per microphone, species, month and score band of 0.1, the first heard:
//     enough to measure how often the detector is wrong at each score, without the bulk of the false alarms.
// The copy itself runs on the host (deploy/clip-archive.sh), which holds the key to the Storage Box; this side only
// says which files to copy and records what arrived. The archive keeps the files under the same names as CLIP_DIR
// (<device>/<sha256>.<ext>) with a CSV per place and month beside them (manifest/<place>/<YYYY-MM>.csv), so a clip
// can be found again without this database. On while CLIP_ARCHIVE=1; off, the oracle deletes sound as it always did.

export const ARCHIVE_MIN_SCORE = 0.5;
export const ARCHIVE_PER_BAND = 5;
/** A clip below the line is judged after this many days, so one that arrives late in its month can still take a slot. */
export const ARCHIVE_JUDGE_AFTER_DAYS = 2;

export const archiveOn = () => process.env.CLIP_ARCHIVE === "1";

type Judged = { id: string; file: string; keep: boolean };

// Plain parameters only (an instant as an ISO string cast against the `timestamp` columns, which hold UTC wall time),
// never `Prisma.sql` fragments: see the note in src/lib/node.ts.
const utc = (d: Date) => d.toISOString();

/** The clips that still have their sound here and are not in the archive, with whether each is worth keeping: all of
 * them ("pending"), or only those not judged yet and older than `before` ("judge"). The band slots are counted over
 * every clip that still has its sound or is in the archive, archived ones first, so a judgment made once does not
 * change when more clips arrive. */
async function judged(mode: "pending" | "judge", before = new Date()): Promise<Judged[]> {
  return prisma.$queryRaw<Judged[]>`
    WITH ranked AS (
      SELECT c.id, c.file, c."archivedAt", c."archiveSkip", c."createdAt", c.confidence,
        EXISTS (SELECT 1 FROM "ClipReview" r WHERE r."clipId" = c.id) AS reviewed,
        row_number() OVER (
          PARTITION BY c."deviceId", coalesce(c.source, ''), c.scientific, date_trunc('month', c.ts), floor(c.confidence * 10)
          ORDER BY (c."archivedAt" IS NULL), c.ts, c.id) AS rn
      FROM "Clip" c
      WHERE c.file IS NOT NULL OR c."archivedAt" IS NOT NULL
    )
    SELECT id, file, (confidence >= ${ARCHIVE_MIN_SCORE} OR reviewed OR rn <= ${ARCHIVE_PER_BAND}) AS keep
    FROM ranked
    WHERE file IS NOT NULL AND "archivedAt" IS NULL
      AND (${mode} = 'pending' OR (NOT "archiveSkip" AND "createdAt" < (${utc(before)}::timestamptz AT TIME ZONE 'UTC')))`;
}

/** The files to copy now: clips worth keeping whose sound is here and not yet in the archive. */
export async function archivePending(): Promise<string[]> {
  const rows = await judged("pending");
  return [...new Set(rows.filter((r) => r.keep).map((r) => r.file))].sort();
}

/** Records that these files reached the archive; every clip that shares one of them is marked. */
export async function archiveDone(files: string[], now = new Date()): Promise<number> {
  let n = 0;
  for (const file of new Set(files)) {
    const r = await prisma.clip.updateMany({ where: { file, archivedAt: null }, data: { archivedAt: now, archiveFile: file, archiveSkip: false } });
    n += r.count;
  }
  return n;
}

/** Marks the clips below the line, older than ARCHIVE_JUDGE_AFTER_DAYS, as not worth keeping, so their sound may go.
 * One judged later is kept after all: it then counts as worth keeping in archivePending, and pruneClips spares it. */
export async function archiveSkip(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - ARCHIVE_JUDGE_AFTER_DAYS * 86400e3);
  const rows = await judged("judge", before);
  const ids = rows.filter((r) => !r.keep).map((r) => r.id);
  if (!ids.length) return 0;
  const r = await prisma.clip.updateMany({ where: { id: { in: ids } }, data: { archiveSkip: true } });
  return r.count;
}

const COLUMNS = ["clip", "place", "device", "source", "ts", "scientific", "species", "confidence", "band", "detector", "clip_s", "from_s", "to_s", "file", "mime", "bytes", "expansion", "gain_db", "sha256", "archived_at"] as const;
const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Writes the CSV of every place and month that got clips in the archive since `since`, all of that month's archived
 * clips in each, to DIR/<place>/<YYYY-MM>.csv. Returns the files written, relative to DIR. */
export async function archiveManifests(dir: string, since: Date): Promise<string[]> {
  const touched = await prisma.$queryRaw<{ placeId: string; month: string }[]>`
    SELECT DISTINCT d."placeId", to_char(c.ts, 'YYYY-MM') AS month
    FROM "Clip" c JOIN "Device" d ON d.id = c."deviceId"
    WHERE c."archivedAt" >= (${utc(since)}::timestamptz AT TIME ZONE 'UTC')`;
  const out: string[] = [];
  for (const { placeId, month } of touched) {
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const clips = await prisma.clip.findMany({
      where: { archivedAt: { not: null }, device: { placeId }, ts: { gte: from, lt: to } },
      orderBy: [{ ts: "asc" }, { id: "asc" }],
    });
    const lines = [COLUMNS.join(",")];
    for (const c of clips) {
      lines.push([c.id, placeId, c.deviceId, c.source, c.ts, c.scientific, c.species, c.confidence, c.band, c.detector, c.clipS, c.fromS, c.toS,
        c.archiveFile, c.mime, c.bytes, c.expansion, c.gainDb, c.sha256, c.archivedAt].map(cell).join(","));
    }
    const rel = path.join(placeId, `${month}.csv`);
    await mkdir(path.join(dir, placeId), { recursive: true });
    await writeFile(path.join(dir, rel), lines.join("\n") + "\n");
    out.push(rel);
  }
  return out.sort();
}

/** Counts for the status line and the tests. */
export async function archiveStatus() {
  const [archived, skipped, waiting, kept] = await Promise.all([
    prisma.clip.count({ where: { archivedAt: { not: null } } }),
    prisma.clip.count({ where: { archiveSkip: true } }),
    archivePending().then((f) => f.length),
    prisma.clip.count({ where: { file: { not: null }, reviews: { some: {} } } }),
  ]);
  return { on: archiveOn(), archived, skipped, waitingFiles: waiting, reviewedOnOracle: kept };
}
