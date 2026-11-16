/**
 * The oracle's half of the research archive (src/lib/clip-archive.ts), for the host job deploy/clip-archive.sh, which
 * runs it in the worker container and does the copying itself:
 *   npx tsx scripts/clip-archive.ts pending          the files to copy, one per line, relative to CLIP_DIR
 *   npx tsx scripts/clip-archive.ts done < files     these reached the archive
 *   npx tsx scripts/clip-archive.ts skip             judge the clips below the line older than two days
 *   npx tsx scripts/clip-archive.ts manifest DIR [SINCE]
 *                                                    write the CSV per place and month that got clips since SINCE
 *                                                    (an ISO instant, default the last two days) under DIR
 *   npx tsx scripts/clip-archive.ts status           counts, as JSON
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { archiveDone, archiveManifests, archivePending, archiveSkip, archiveStatus } from "../src/lib/clip-archive";
import { prisma } from "../src/lib/db";

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "pending") {
    for (const f of await archivePending()) console.log(f);
  } else if (cmd === "done") {
    const files = readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    console.error(`archived: ${await archiveDone(files)} clips in ${files.length} files`);
  } else if (cmd === "skip") {
    console.error(`not kept for research: ${await archiveSkip()} clips`);
  } else if (cmd === "manifest" && a) {
    const since = b ? new Date(b) : new Date(Date.now() - 2 * 86400e3);
    if (Number.isNaN(since.getTime())) throw new Error(`not an instant: ${b}`);
    for (const f of await archiveManifests(a, since)) console.log(f);
  } else if (cmd === "status") {
    console.log(JSON.stringify(await archiveStatus()));
  } else {
    console.error("usage: clip-archive.ts pending | done < files | skip | manifest DIR [SINCE] | status");
    process.exitCode = 2;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
