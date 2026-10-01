import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { SignIn } from "@/components/BoxApp";
import { SignOut } from "@/components/SignOut";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your places", description: "Sign in to see your own places exactly and follow what they measure." };

// The places a signed-in person looks after: given to them (PlaceAccess) or carrying their Life Box.
export default async function MePage() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
        <SignIn title="Your places" intro="Sign in with your email to see your own places with their exact boundary. We send you a six-digit code; there is no password." />
      </div>
    );
  }
  const [access, boxes] = await Promise.all([
    prisma.placeAccess.findMany({ where: { userId: user.id }, include: { place: true }, orderBy: { createdAt: "asc" } }),
    prisma.box.findMany({ where: { userId: user.id }, include: { place: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const seen = new Set<string>();
  const places = [...access.map((a) => a.place), ...boxes.filter((b) => b.placedAt).map((b) => b.place)].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Your places</h1>
      <p className="mt-2 text-muted text-sm">Signed in as {user.email}. On these places you see the exact boundary; everyone else sees a circle.</p>
      {places.length === 0 ? (
        <p className="mt-6">No places yet. A place appears here when it is registered for you, or when your Life Box is in the ground.</p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {places.map((p) => (
            <li key={p.id}>
              <Link href={`/places/${p.slug}`} className="block rounded-lg border border-line bg-white p-4 hover:border-accent">
                <div className="font-semibold">{p.name}</div>
                <div className="text-sm text-muted mt-1">{p.areaHa.toFixed(2)} ha · {p.landUse ?? "land use unknown"}{p.public ? "" : " · not on the public map"}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8 flex gap-4 text-sm">
        <Link href="/box" className="underline">Your Life Boxes</Link>
        <SignOut />
      </div>
    </div>
  );
}
