import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { goldenVersion, imageStream } from "@/lib/boximage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in at /box first.", { status: 401 });
  const { id } = await ctx.params;
  const box = await prisma.box.findFirst({ where: { id, userId: user.id } });
  if (!box || box.imageStatus !== "READY") return new Response("No image for this box yet.", { status: 404 });
  // the download is this box's own first part followed by the golden image's shared rest; after a new golden image
  // the two no longer fit together, and the card would not start
  if (box.imageVersion !== (await goldenVersion())) return new Response("There is newer software for this box. Go back to /box and press \"Make the software again\".", { status: 409 });
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
