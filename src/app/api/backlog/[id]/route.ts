import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, unauthorized } from "@/lib/auth";
import { At, LANES, backlogEditor, cardSelect, listCards, rankFor } from "@/lib/backlog";

export const dynamic = "force-dynamic";

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(4000).nullable().optional(),
  author: z.string().trim().max(60).nullable().optional(),
  lane: z.enum(LANES).optional(),
  // where in the lane; a card that changes lane without it goes on top
  at: At.optional(),
});

// Edit a card, or move it: to another lane and/or to a place within one.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await backlogEditor(req))) return unauthorized();
  const { id } = await params;
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.path[0] === "title" ? "A title needs one to 200 characters." : "bad request" }, 400);
  const b = p.data;
  const card = await prisma.$transaction(async (tx) => {
    const cur = await tx.backlogCard.findUnique({ where: { id } });
    if (!cur) return null;
    const lane = b.lane ?? cur.lane;
    const at = b.at ?? (lane !== cur.lane ? "top" : undefined);
    return tx.backlogCard.update({
      where: { id },
      data: {
        title: b.title,
        body: b.body === undefined ? undefined : b.body || null,
        author: b.author === undefined ? undefined : b.author || null,
        lane,
        rank: at ? await rankFor(tx, lane, at, id) : undefined,
        doneAt: lane === cur.lane ? undefined : lane === "DONE" ? new Date() : null,
      },
      select: cardSelect,
    });
  });
  if (!card) return json({ error: "That card is gone; someone deleted it." }, 404);
  return json({ card, cards: await listCards() });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await backlogEditor(req))) return unauthorized();
  const { id } = await params;
  await prisma.backlogCard.deleteMany({ where: { id } });
  return json({ cards: await listCards() });
}
