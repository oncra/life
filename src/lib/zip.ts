import { crc32 } from "node:zlib";

// A zip without compression (clips are compressed already), written as a stream one file at a time, so a month of
// clips never sits in memory. The ZIP64 records are added only when an offset or the number of files outgrows the
// classic format; macOS, Windows and every unzip read both.

export type ZipFile = { name: string; time: Date; data: () => Promise<Buffer | null> };

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

function dos(d: Date): { time: number; date: number } {
  const y = Math.min(2107, Math.max(1980, d.getUTCFullYear()));
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}

type Entry = { name: Buffer; crc: number; size: number; offset: number; time: number; date: number };

function localHeader(e: Entry): Buffer {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6);           // names in UTF-8
  h.writeUInt16LE(0, 8);                // stored
  h.writeUInt16LE(e.time, 10);
  h.writeUInt16LE(e.date, 12);
  h.writeUInt32LE(e.crc, 14);
  h.writeUInt32LE(e.size, 18);
  h.writeUInt32LE(e.size, 22);
  h.writeUInt16LE(e.name.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, e.name]);
}

function centralHeader(e: Entry): Buffer {
  const big = e.offset >= MAX32;
  const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
  if (big) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(BigInt(e.offset), 4);
  }
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE((3 << 8) | 45, 4);    // made on Unix, spec 4.5
  h.writeUInt16LE(big ? 45 : 20, 6);
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(e.time, 12);
  h.writeUInt16LE(e.date, 14);
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.size, 20);
  h.writeUInt32LE(e.size, 24);
  h.writeUInt16LE(e.name.length, 28);
  h.writeUInt16LE(extra.length, 30);
  h.writeUInt16LE(0, 32);
  h.writeUInt16LE(0, 34);
  h.writeUInt16LE(0, 36);
  h.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  h.writeUInt32LE(big ? MAX32 : e.offset, 42);
  return Buffer.concat([h, e.name, extra]);
}

function end(count: number, cdOffset: number, cdSize: number): Buffer {
  const parts: Buffer[] = [];
  if (count >= MAX16 || cdOffset >= MAX32 || cdSize >= MAX32) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(BigInt(44), 4);
    z.writeUInt16LE((3 << 8) | 45, 12);
    z.writeUInt16LE(45, 14);
    z.writeUInt32LE(0, 16);
    z.writeUInt32LE(0, 20);
    z.writeBigUInt64LE(BigInt(count), 24);
    z.writeBigUInt64LE(BigInt(count), 32);
    z.writeBigUInt64LE(BigInt(cdSize), 40);
    z.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(z, loc);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(Math.min(count, MAX16), 8);
  e.writeUInt16LE(Math.min(count, MAX16), 10);
  e.writeUInt32LE(Math.min(cdSize, MAX32), 12);
  e.writeUInt32LE(Math.min(cdOffset, MAX32), 16);
  parts.push(e);
  return Buffer.concat(parts);
}

/** The zip of these files as a stream. A file whose data comes back null (its sound was deleted meanwhile) is left out.
 * Names must be unique; each file must be under 4 GB. */
export function zipStream(files: Iterable<ZipFile> | AsyncIterable<ZipFile>): ReadableStream<Uint8Array> {
  const entries: Entry[] = [];
  let offset = 0;
  let it: AsyncIterator<ZipFile> | Iterator<ZipFile> | null = null;
  let done = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;
      it ??= Symbol.asyncIterator in files ? (files as AsyncIterable<ZipFile>)[Symbol.asyncIterator]() : (files as Iterable<ZipFile>)[Symbol.iterator]();
      for (;;) {
        const next = await it.next();
        if (next.done) {
          const cd = Buffer.concat(entries.map(centralHeader));
          controller.enqueue(new Uint8Array(Buffer.concat([cd, end(entries.length, offset, cd.length)])));
          controller.close();
          done = true;
          return;
        }
        const data = await next.value.data();
        if (!data) continue;
        if (data.length >= MAX32) throw new Error(`${next.value.name}: a file in this zip is under 4 GB`);
        const t = dos(next.value.time);
        const e: Entry = { name: Buffer.from(next.value.name, "utf8"), crc: crc32(data) >>> 0, size: data.length, offset, ...t };
        const head = localHeader(e);
        entries.push(e);
        offset += head.length + data.length;
        controller.enqueue(new Uint8Array(Buffer.concat([head, data])));
        return;
      }
    },
  });
}
