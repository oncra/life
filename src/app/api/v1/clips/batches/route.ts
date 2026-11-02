import { prisma } from "@/lib/db";
import { json } from "@/lib/auth";
import { grantOf, itemsHash, itemsHeld, MAX_BATCH, validItems } from "@/lib/grant";
export const dynamic = "force-dynamic";

// A laptop registers the batch it took from a node before it sends the clips: `Authorization: Grant lg1...` and
// {items: [{ref, sha256}], laptop?}, the list the node gave with the grant. The oracle checks the list against the
// grant's fingerprint and keeps it, so each clip that follows can be checked against it, and answers with the refs it
// already has with the same SHA-256 (sent earlier over a hotspot, or by this laptop before a break): those need not
// be sent again. Registering the same batch twice is harmless.
export async function POST(req: Request) {
  const granted = await grantOf(req);
  if (!granted) return json({ error: "send the node's grant: Authorization: Grant lg1..." }, 401);
  if ("error" in granted) return json({ error: granted.error }, granted.status);
  const { grant } = granted;
  const body = (await req.json().catch(() => null)) as { items?: unknown; laptop?: unknown } | null;
  const items = body?.items;
  if (!validItems(items)) return json({ error: `items: 1 to ${MAX_BATCH} of {ref, sha256}, each ref once` }, 400);
  if (items.length !== grant.n || itemsHash(items) !== grant.hash) return json({ error: "these are not the clips the node signed over" }, 409);
  const laptop = typeof body?.laptop === "string" ? body.laptop.slice(0, 80) : null;
  const known = await prisma.clipBatch.findUnique({ where: { deviceId_batch: { deviceId: grant.deviceId, batch: grant.batch } } });
  if (known && known.hash !== grant.hash) return json({ error: "the node signed another list under this batch" }, 409);
  if (!known) {
    await prisma.clipBatch.create({
      data: { deviceId: grant.deviceId, batch: grant.batch, n: grant.n, hash: grant.hash, items: items.map((i) => ({ ref: i.ref, sha256: i.sha256 })), laptop, expiresAt: grant.expiresAt },
    }).catch((e: unknown) => {
      if ((e as { code?: string }).code !== "P2002") throw e;   // registered by a second request at the same moment
    });
  }
  const have = await itemsHeld(grant.deviceId, items);
  return json({ ok: true, device: grant.deviceId, batch: grant.batch, n: grant.n, have, expiresAt: grant.expiresAt.toISOString() }, known ? 200 : 201);
}
