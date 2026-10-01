import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { imageStream } from "@/lib/boximage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in at /box first.", { status: 401 });
  const { id } = await ctx.params;
  const box = await prisma.box.findFirst({ where: { id, userId: user.id } });
  if (!box || box.imageStatus !== "READY") return new Response("No image for this box yet.", { status: 404 });
  const { stream, bytes } = await imageStream(box.id);
  return new Response(stream, {
    headers: {
      "content-type": "application/x-xz",
      "content-length": String(bytes),
      "content-disposition": `attachment; filename="${box.hostname}.img.xz"`,
      "cache-control": "private, no-store",
    },
  });
}
