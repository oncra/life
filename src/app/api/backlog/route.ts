import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { At, LANES, backlogEditor, cardSelect, listCards, rankFor } from "@/lib/backlog";

export const dynamic = "force-dynamic";

// Public: the whole board, and whether this visitor may change it.
export async function GET(req: Request) {
  const [cards, editor] = await Promise.all([listCards(), backlogEditor(req)]);
  return json({ cards, editor });
}

const Card = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).optional(),
  author: z.string().trim().max(60).optional(),
  lane: z.enum(LANES).default("BACKLOG"),
  at: At.default("top"),
});

export async function POST(req: Request) {
  if (!(await backlogEditor(req))) return unauthorized();
  const p = Card.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "An idea needs a title (at most 200 characters)." }, 400);
  if ((await prisma.backlogCard.count()) >= 2000) return json({ error: "The board holds 2000 cards. Delete some done ones first." }, 429);
  const b = p.data;
  const card = await prisma.$transaction(async (tx) =>
    tx.backlogCard.create({
      data: { lane: b.lane, rank: await rankFor(tx, b.lane, b.at), title: b.title, body: b.body || null, author: b.author || null, doneAt: b.lane === "DONE" ? new Date() : null },
      select: cardSelect,
    }),
  );
  return json({ card, cards: await listCards() }, 201);
}
