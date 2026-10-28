import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { clipPath, mayHear } from "@/lib/clips";
export const dynamic = "force-dynamic";

// A clip's sound for the triage page, with byte ranges: Safari on a phone will not play audio without them.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await prisma.clip.findUnique({ where: { id }, select: { deviceId: true, file: true, mime: true } });
  if (!clip || !(await mayHear(clip.deviceId, req))) return new Response("not found", { status: 404 });
  if (!clip.file) return new Response("this clip's sound has been deleted", { status: 410 });
  const file = clipPath(clip.file);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response("this clip's sound is missing", { status: 410 });
  }
  const headers: Record<string, string> = { "content-type": clip.mime ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start: number;
    let end: number;
    if (m[1] === "") {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || end < start) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers: { ...headers, "content-length": String(size) } });
}
