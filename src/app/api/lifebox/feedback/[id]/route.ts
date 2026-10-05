import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, json, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Patch = z.object({
  status: z.enum(["NEW", "QUEUED", "RUNNING", "DONE", "BLOCKED", "DISMISSED", "ROLLED_BACK"]),
  note: z.string().trim().max(1000).optional(),
  changeUrl: z.string().url().max(300).optional(),
});

// The change runner (admin key) reports what happened to a queued change.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await authenticate(req);
  if (!p || p.kind !== "admin") return unauthorized();
  const { id } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad request" }, 400);
  const { status, note, changeUrl } = parsed.data;
  const now = new Date();
  const item = await prisma.planFeedback.update({
    where: { id },
    data: {
      status, note, changeUrl,
      startedAt: status === "RUNNING" ? now : undefined,
      finishedAt: status === "DONE" || status === "BLOCKED" || status === "DISMISSED" || status === "ROLLED_BACK" ? now : undefined,
    },
  }).catch(() => null);
  if (!item) return json({ error: "not found" }, 404);
  return json({ item });
}
