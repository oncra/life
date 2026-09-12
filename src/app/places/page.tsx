import Link from "next/link";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function Places() {
  const places = await prisma.place.findMany({ where: { public: true }, orderBy: { createdAt: "desc" }, include: { _count: { select: { devices: true, satellite: true } }, readings: { orderBy: { computedAt: "desc" }, take: 7 } } });
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-end justify-between mb-6">
        <h1 className="text-2xl font-semibold">Places</h1>
        <Link href="/places/new" className="px-3 py-2 rounded-md bg-accent text-white text-sm">Register a place</Link>
      </div>
      {places.length === 0 && <p className="text-muted">No places yet.</p>}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {places.map((p) => {
          const falling = p.readings.filter((r) => r.direction === "FALLING").length, unknown = p.readings.filter((r) => r.direction === "UNKNOWN").length;
          return (
            <Link key={p.id} href={`/places/${p.slug}`} className="rounded-lg border border-line bg-white p-4 hover:border-accent">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-muted mt-1">{p.areaHa.toFixed(1)} ha · {p.landUse ?? "land use unknown"} · {p.country ?? ""}</div>
              <div className="text-xs text-muted mt-2">{p._count.satellite} satellite obs · {p._count.devices} devices · {p.readings.length ? `${7 - unknown}/7 readings, ${falling} falling` : "readings pending"}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
