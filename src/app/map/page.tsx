import LifeMap from "@/components/LifeMap";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default function MapPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Map</h1>
          <p className="text-sm text-muted">Registered places coloured by verdict, and every Life Node as a pulsing dot: its rings run while it is being heard, and now and then it says what it last heard. Toggle the greenness layer (MODIS NDVI) and land cover under the layers control. Basemap is Sentinel-2 cloudless.</p>
        </div>
        <Link href="/places/new" className="px-3 py-2 rounded-md bg-accent text-white text-sm">Register a place</Link>
      </div>
      <LifeMap fetchPlaces fetchSignals ndviDate="auto" height="75vh" />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {[["thriving", "#2f6b3a"], ["holding", "#8a9a2b"], ["declining", "#b3452b"], ["insufficient data", "#7a7a72"]].map(([l, c]) => (
          <span key={l} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: c }} /> {l}</span>
        ))}
        <span className="flex items-center gap-1 ml-2"><span className="inline-block w-3 h-3 rounded-full bg-accent border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.2)]" /> node heard in the last three hours</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-amber-600 border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.2)]" /> quiet</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-[#7a7a72] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.2)]" /> silent for more than 36 hours</span>
      </div>
    </div>
  );
}
