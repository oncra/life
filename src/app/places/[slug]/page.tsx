import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import LifeMap from "@/components/LifeMap";
import NdviChart from "@/components/NdviChart";
import { growingSeasonMeans, verdict, type ReadingOut } from "@/lib/readings";
import { carbonSeries, issuable } from "@/lib/carbon";
export const dynamic = "force-dynamic";

const DIM_TEXT: Record<string, [string, string]> = {
  PRODUCTIVITY: ["Productivity", "capturing energy and building biomass (satellite greenness over the growing season)"],
  DIVERSITY: ["Diversity", "differentiating into many forms (species heard per year)"],
  STRUCTURE: ["Structure", "trophic levels and habitat complexity (acoustic indices)"],
  RENEWAL: ["Renewal", "reproducing and recruiting (breeding-season song)"],
  CYCLING: ["Cycling", "closing water and nutrient loops (soil breathing from moisture and temperature)"],
  RESILIENCE: ["Resilience", "recovering after shocks (drought years in the satellite archive)"],
  AUTONOMY: ["Autonomy", "holding its state with little management (machine noise)"],
};
const DIR: Record<string, [string, string]> = { RISING: ["rising", "text-green-800 bg-green-50 border-green-200"], HOLDING: ["holding", "text-lime-800 bg-lime-50 border-lime-200"], FALLING: ["falling", "text-red-800 bg-red-50 border-red-200"], UNKNOWN: ["unknown", "text-gray-600 bg-gray-50 border-gray-200"] };

export default async function PlacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const place = await prisma.place.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
  if (!place) notFound();
  const [sat, readings, devices, jobs, visits, soilRows, alerts] = await Promise.all([
    prisma.satelliteObs.findMany({ where: { placeId: place.id }, orderBy: { date: "asc" } }),
    prisma.reading.findMany({ where: { placeId: place.id }, orderBy: { computedAt: "desc" } }),
    prisma.device.findMany({ where: { placeId: place.id } }),
    prisma.job.findMany({ where: { placeId: place.id }, orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.visit.findMany({ where: { placeId: place.id }, orderBy: { date: "desc" }, take: 10 }),
    prisma.soilReading.findMany({ where: { device: { placeId: place.id } }, select: { ts: true, depthCm: true, vwc: true, tempC: true } }),
    prisma.alert.findMany({ where: { device: { placeId: place.id }, resolvedAt: null }, orderBy: { createdAt: "desc" }, include: { device: { select: { model: true } } } }),
  ]);
  const clayPct = (place.context as { soil?: { clayPct?: number } } | null)?.soil?.clayPct;
  const carbon = carbonSeries(sat.map((s) => ({ date: s.date, ndvi: s.ndviMean })), soilRows, place.landUse, clayPct);
  const issue = issuable(carbon, place.areaHa);
  const periods = [...new Set(readings.map((r) => r.period))].sort().reverse();
  const latest = readings.filter((r) => r.period === periods[0]);
  const order = ["PRODUCTIVITY", "DIVERSITY", "STRUCTURE", "RENEWAL", "CYCLING", "RESILIENCE", "AUTONOMY"];
  latest.sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension));
  const list: ReadingOut[] = latest.map((r) => ({ dimension: r.dimension, direction: r.direction, confidence: r.confidence, maturity: r.maturity, evidence: (r.evidence as Record<string, unknown>) ?? {} }));
  const v = list.length === 7 ? verdict(list) : { verdict: "insufficient", reason: jobs[0]?.status === "running" || jobs[0]?.status === "queued" ? "satellite backfill in progress" : "not yet computed" };
  const seasons = growingSeasonMeans(sat.map((s) => ({ date: s.date, ndvi: s.ndviMean })), place.centroidLat);
  const vcol: Record<string, string> = { thriving: "bg-green-700", holding: "bg-lime-600", declining: "bg-red-700", insufficient: "bg-gray-500" };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted"><Link href="/places" className="underline">Places</Link> / {place.slug}</div>
          <h1 className="text-2xl font-semibold mt-1">{place.name}</h1>
          <div className="text-sm text-muted mt-1">{place.areaHa.toFixed(2)} ha · {place.landUse ?? "land use unknown"} · {place.country ?? ""} · centroid {place.centroidLat.toFixed(4)}, {place.centroidLon.toFixed(4)}</div>
          {place.description && <p className="mt-2 text-sm max-w-2xl">{place.description}</p>}
        </div>
        <div className={`rounded-lg text-white px-4 py-3 ${vcol[v.verdict]}`}>
          <div className="text-xs uppercase tracking-wide opacity-80">Verdict {periods[0] ? `· ${periods[0]}` : ""}</div>
          <div className="text-xl font-semibold capitalize">{v.verdict === "insufficient" ? "Insufficient data" : v.verdict}</div>
          <div className="text-xs opacity-90 mt-1 max-w-xs">{v.reason}</div>
        </div>
      </div>

      <div className="mt-6 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2"><LifeMap height="360px" focus={place.geometry as unknown as GeoJSON.Geometry} center={[place.centroidLat, place.centroidLon]} zoom={14} /></div>
        <div className="rounded-lg border border-line bg-white p-4 text-sm">
          <h2 className="font-semibold">Streams</h2>
          <ul className="mt-2 space-y-1 text-muted">
            <li>Satellite: {sat.length} clear observations{sat.length ? `, ${sat[0].date.toISOString().slice(0, 10)} to ${sat[sat.length - 1].date.toISOString().slice(0, 10)}` : ""}</li>
            <li>Sound recorders: {devices.filter((d) => d.kind === "SOUND").length}</li>
            <li>Soil probes: {devices.filter((d) => d.kind === "SOIL").length}</li>
            <li>Visits: {visits.length}</li>
          </ul>
          {(() => { const soil = (place.context as { soil?: { clayPct: number; sandPct: number; siltPct: number; socPct: number; ph: number; wrbClass: string | null } } | null)?.soil; return soil ? (
            <div className="mt-3 text-xs text-muted">Soil (SoilGrids 250 m, ISRIC, CC BY 4.0): {soil.wrbClass ?? "class unknown"}, clay {soil.clayPct}% · sand {soil.sandPct}% · silt {soil.siltPct}% · organic carbon {soil.socPct}% · pH {soil.ph}</div>
          ) : null; })()}
          {jobs[0] && <div className="mt-3 text-xs text-muted">Last job: {jobs[0].kind} · {jobs[0].status}{jobs[0].error ? ` · ${jobs[0].error.slice(0, 80)}` : ""}</div>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <a className="underline" href={`/api/v1/places/${place.slug}`}>JSON</a>
            <a className="underline" href={`/api/v1/places/${place.slug}/satellite?format=csv`}>NDVI CSV</a>
            <a className="underline" href={`/api/v1/places/${place.slug}/readings`}>Readings JSON</a>
            <Link className="underline" href="/docs/guide-steward">Add a device</Link>
          </div>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Seven readings</h2>
        <p className="text-sm text-muted">The verdict is the weakest of the seven. Unknown is a real answer: it says which stream still has to arrive.</p>
        <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {(list.length ? list : order.map((d) => ({ dimension: d, direction: "UNKNOWN", confidence: 0, maturity: 0, evidence: { note: "not yet computed" } }))).map((r) => {
            const [label, what] = DIM_TEXT[r.dimension];
            const [dl, cls] = DIR[r.direction];
            const note = (r.evidence as { note?: string }).note;
            return (
              <div key={r.dimension} className={`rounded-lg border p-3 ${cls}`}>
                <div className="flex items-baseline justify-between"><span className="font-semibold">{label}</span><span className="text-sm">{dl}</span></div>
                <div className="text-xs opacity-80 mt-1">{what}</div>
                <div className="text-xs mt-2">confidence {(r.confidence * 100).toFixed(0)}% · held {r.maturity} period{r.maturity === 1 ? "" : "s"}</div>
                {note && <div className="text-xs mt-1 opacity-90">{note}</div>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Satellite greenness (NDVI), Sentinel-2</h2>
        <p className="text-sm text-muted">Each dot is one clear scene, cloud-masked with the scene classification layer, averaged over the pixels inside the boundary. Shaded bands are growing seasons.</p>
        <div className="mt-3 rounded-lg border border-line bg-white p-3"><NdviChart points={sat.map((s) => ({ date: s.date.toISOString(), ndvi: s.ndviMean }))} /></div>
        {seasons.length > 0 && (
          <table className="mt-3 text-sm border-collapse">
            <thead><tr className="text-left text-muted"><th className="pr-4 py-1">Growing season</th><th className="pr-4">Mean NDVI</th><th>Clear scenes</th></tr></thead>
            <tbody>{seasons.map((s) => <tr key={s.year}><td className="pr-4 py-0.5">{s.year}</td><td className="pr-4">{s.mean.toFixed(3)}</td><td>{s.n}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      {carbon.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Carbon, inferred (v0.1, a range, not an issuance)</h2>
          <p className="text-sm text-muted">Net ecosystem carbon balance per year: productivity from satellite greenness, minus soil breathing ({carbon[carbon.length - 1].rhSource === "soil-probe" ? "from the soil probe" : "from a temperature climatology until a probe exists"}), minus harvest export for this land use. Every parameter carries a low and a high value; the range is what the evidence supports. Credits would be issued for the lower bound. <a className="underline" href="/docs/carbon">Method</a> · <a className="underline" href={`/api/v1/places/${place.slug}/carbon`}>JSON</a></p>
          <table className="mt-3 text-sm border-collapse">
            <thead><tr className="text-left text-muted"><th className="pr-4 py-1">Year</th><th className="pr-4">Scenes</th><th className="pr-4">NPP t C/ha</th><th className="pr-4">Soil breathing t C/ha</th><th className="pr-4">Export t C/ha</th><th className="pr-4">Net t CO₂/ha (box)</th><th className="pr-4">Central</th><th>Lower bound for {place.areaHa.toFixed(0)} ha, t CO₂</th></tr></thead>
            <tbody>{carbon.map((c, i) => <tr key={c.year} className="border-t border-line"><td className="pr-4 py-0.5">{c.year}</td><td className="pr-4">{c.observations}</td><td className="pr-4">{c.nppTC.low.toFixed(1)} to {c.nppTC.high.toFixed(1)}</td><td className="pr-4">{c.rhTC.low.toFixed(1)} to {c.rhTC.high.toFixed(1)}</td><td className="pr-4">{c.exportTC.low.toFixed(1)} to {c.exportTC.high.toFixed(1)}</td><td className="pr-4">{c.necbCO2.low.toFixed(1)} to {c.necbCO2.high.toFixed(1)}</td><td className="pr-4">{c.necbCO2.mid.toFixed(1)}</td><td>{issue[i].lowerBoundTCO2.toFixed(0)}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {devices.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Devices</h2>
          {alerts.length > 0 && (
            <ul className="mt-2 text-sm">
              {alerts.map((a) => <li key={a.id} className="text-falling">{a.kind === "SILENT" ? `${a.device.model}: silent since ${((a.detail as { lastHeartbeatAt?: string } | null)?.lastHeartbeatAt ?? a.createdAt.toISOString()).slice(0, 16).replace("T", " ")} UTC` : a.kind === "TAMPER" ? `${a.device.model}: ${(a.detail as { loop?: string } | null)?.loop ?? "a loop"} opened outside a maintenance window, ${a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : `${a.device.model}: on another cell than it was installed in, since ${a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}</li>)}
            </ul>
          )}
          <table className="mt-2 text-sm w-full"><thead><tr className="text-left text-muted"><th className="py-1">Kind</th><th>Model</th><th>Position</th><th>Installed</th><th>Last seen</th><th>Heartbeat</th></tr></thead>
            <tbody>{devices.map((d) => <tr key={d.id} className="border-t border-line"><td className="py-1">{d.kind}</td><td>{d.model}</td><td>{d.lat && d.lon ? `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}` : ""}{d.heightM ? ` · ${d.heightM} m` : ""}{d.depthCm ? ` · ${d.depthCm} cm` : ""}</td><td>{d.installedAt?.toISOString().slice(0, 10) ?? ""}</td><td>{d.lastSeenAt?.toISOString().slice(0, 16).replace("T", " ") ?? "never"}</td><td>{d.lastHeartbeatAt ? d.lastHeartbeatAt.toISOString().slice(0, 16).replace("T", " ") : ""}{d.maintenanceUntil && d.maintenanceUntil > new Date() ? ` · maintenance until ${d.maintenanceUntil.toISOString().slice(0, 16).replace("T", " ")}` : ""}</td></tr>)}</tbody></table>
        </section>
      )}
    </div>
  );
}
