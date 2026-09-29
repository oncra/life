import { z } from "zod";
import { prisma } from "@/lib/db";
import { authenticate, json, unauthorized } from "@/lib/auth";
import { isPlanPage } from "@/lib/lifebox";

export const dynamic = "force-dynamic";

const publicSelect = { id: true, page: true, kind: true, status: true, body: true, author: true, note: true, changeUrl: true, createdAt: true } as const;

// Public: the feedback shown on one plan page. Admin: the queue for the change runner (?status=QUEUED).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  if (status) {
    const p = await authenticate(req);
    if (!p || p.kind !== "admin") return unauthorized();
    const items = await prisma.planFeedback.findMany({ where: { status: status as never }, orderBy: { createdAt: "asc" }, take: 20 });
    return json({ count: items.length, items });
  }
  const page = u.searchParams.get("page") ?? "index";
  if (!isPlanPage(page)) return json({ error: "no such page" }, 404);
  const items = await prisma.planFeedback.findMany({ where: { page, status: { not: "DISMISSED" } }, orderBy: { createdAt: "desc" }, take: 50, select: publicSelect });
  return json({ items });
}

const Body = z.object({
  page: z.string().min(1).max(60),
  kind: z.enum(["NOTE", "AI_CHANGE"]),
  body: z.string().trim().min(3).max(2000),
  author: z.string().trim().max(60).optional(),
  code: z.string().max(80).optional(),
  website: z.string().max(0).optional(), // honeypot
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad request" }, 400);
  const b = parsed.data;
  if (!isPlanPage(b.page)) return json({ error: "no such page" }, 404);
  const recent = await prisma.planFeedback.count({ where: { createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= 60) return json({ error: "too much feedback in the last hour; try later" }, 429);
  let status: "NEW" | "QUEUED" = "NEW";
  if (b.kind === "AI_CHANGE") {
    const want = process.env.LIFEBOX_ACCESS_CODE;
    if (!want || !b.code || b.code !== want) return json({ error: "change code required" }, 403);
    status = "QUEUED";
  }
  const item = await prisma.planFeedback.create({ data: { page: b.page, kind: b.kind, status, body: b.body, author: b.author || null }, select: publicSelect });
  return json({ item }, 201);
}
