/**
 * BirdWeather poller. A SOUND device whose model contains "birdweather" and whose `serial` is the
 * BirdWeather station id gets its detections pulled from the public GraphQL API (no key needed),
 * so a PUC in the field feeds the oracle without any script on the farm.
 */
import { prisma } from "./db";

const GQL = "https://app.birdweather.com/graphql";
const QUERY = `query($ids:[ID!],$after:String){ detections(stationIds:$ids, first:500, after:$after, period:{count:2, unit:"day"}) {
  nodes { id timestamp confidence probability species { commonName scientificName } }
  pageInfo { hasNextPage endCursor } } }`;

interface Node { id: string; timestamp: string; confidence: number; probability: number; species: { commonName: string; scientificName: string } }

export async function pollBirdWeather(log: (...a: unknown[]) => void) {
  const devices = await prisma.device.findMany({ where: { kind: "SOUND", model: { contains: "birdweather", mode: "insensitive" }, serial: { not: null } } });
  for (const d of devices) {
    try {
      const nodes: Node[] = [];
      let after: string | null = null;
      for (let page = 0; page < 20; page++) {
        const r = await fetch(GQL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: QUERY, variables: { ids: [d.serial], after } }), signal: AbortSignal.timeout(30_000) });
        if (!r.ok) throw new Error(`birdweather ${r.status}`);
        const j = (await r.json()) as { data?: { detections: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }; errors?: unknown };
        if (!j.data) throw new Error(`birdweather: ${JSON.stringify(j.errors).slice(0, 200)}`);
        nodes.push(...j.data.detections.nodes);
        if (!j.data.detections.pageInfo.hasNextPage) break;
        after = j.data.detections.pageInfo.endCursor;
      }
      if (!nodes.length) { log(`birdweather ${d.serial}: no detections in the last two days`); continue; }
      const since = new Date(Math.min(...nodes.map((n) => new Date(n.timestamp).getTime())));
      const existing = await prisma.soundDetection.findMany({ where: { deviceId: d.id, ts: { gte: since } }, select: { ts: true, species: true } });
      const seen = new Set(existing.map((e) => `${e.ts.getTime()}|${e.species}`));
      const rows = nodes
        .filter((n) => !seen.has(`${new Date(n.timestamp).getTime()}|${n.species.commonName}`))
        .map((n) => ({ deviceId: d.id, ts: new Date(n.timestamp), species: n.species.commonName, scientific: n.species.scientificName, confidence: n.confidence, detector: "birdweather-puc", durationS: 3 }));
      if (rows.length) await prisma.soundDetection.createMany({ data: rows, skipDuplicates: true });
      await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date(Math.max(...nodes.map((n) => new Date(n.timestamp).getTime()))) } });
      log(`birdweather ${d.serial}: ${nodes.length} fetched, ${rows.length} new`);
    } catch (e) {
      log(`birdweather ${d.serial}: ${String(e).slice(0, 200)}`);
    }
  }
}
