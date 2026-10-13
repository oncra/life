import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canSeeExact, publicPlace } from "@/lib/privacy";
import { asRange, lastHeard, nodeData, nodeSignals, RANGES, signalPoint } from "@/lib/node";
import LastHeard from "@/components/node/LastHeard";
import { signalStatus, type NodeSignal } from "@/lib/node-signal";
import { asIndexRange, INDEX_RANGES, lifeIndexData } from "@/lib/life-index";
import { ago, dayLabel, fmtTime } from "@/lib/clock";
import LifeMap from "@/components/LifeMap";
import Globe from "@/components/node/Globe";
import LifeIndexChart from "@/components/node/LifeIndexChart";
import Collapsible from "@/components/node/Collapsible";
import SeriesChart from "@/components/node/SeriesChart";
import HeartbeatStrip from "@/components/node/HeartbeatStrip";
import DawnChorus from "@/components/node/DawnChorus";
export const dynamic = "force-dynamic";

// The node dashboard is public for every place (decided 11 October 2026), also for a private one: it shows what the
// box measured and how it is doing, never where it stands. The map point goes through `signalPoint`, which blurs it
// for everyone who may not see the place exactly, and the cell id in the heartbeat is never shown.

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ range?: string | string[]; index?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await prisma.place.findFirst({ where: { OR: [{ slug }, { id: slug }] }, select: { name: true } });
  return { title: p ? `Life Node at ${p.name}` : "Life Node", description: "What the node measured and how it was doing, over time: the life index, soil, sound, battery and heartbeats." };
}

const STATUS_TEXT = { live: "on", stale: "quiet", silent: "silent" } as const;
const STATUS_BG = { live: "bg-accent", stale: "bg-amber-500", silent: "bg-[#7a7a72]" } as const;
const DIM_LABEL: Record<string, string> = { PRODUCTIVITY: "Productivity", DIVERSITY: "Diversity", STRUCTURE: "Structure", RENEWAL: "Renewal", CYCLING: "Cycling", RESILIENCE: "Resilience", AUTONOMY: "Autonomy" };
const DIR_CLASS: Record<string, string> = { RISING: "text-green-800 bg-green-50 border-green-200", HOLDING: "text-lime-800 bg-lime-50 border-lime-200", FALLING: "text-red-800 bg-red-50 border-red-200", UNKNOWN: "text-gray-600 bg-gray-50 border-gray-200" };
const VERDICT_BG: Record<string, string> = { thriving: "bg-green-700", holding: "bg-lime-600", declining: "bg-red-700", insufficient: "bg-gray-500" };

export default async function NodePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const range = asRange(sp.range);
  const indexRange = asIndexRange(sp.index);
  const stored = await prisma.place.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
  if (!stored) notFound();
  const [exact, data] = await Promise.all([canSeeExact(stored), nodeData(stored, range)]);
  if (!data) notFound();
  const [index, heard] = await Promise.all([lifeIndexData(stored, indexRange, data.now), lastHeard(stored.id, 5)]);
  const place = publicPlace(stored, exact);
  const point = signalPoint(stored, exact);
  const status = signalStatus(data.last.heardAt, data.now);
  const { last } = data;
  const lastSpecies = data.species.reduce<(typeof data.species)[number] | null>((a, s) => (!a || s.last > a.last ? s : a), null);
  const signal: NodeSignal = {
    slug: stored.slug, name: stored.name, lat: point.lat, lon: point.lon, radiusM: point.radiusM,
    heardAt: last.heardAt ? new Date(last.heardAt).toISOString() : null, heartbeatAt: last.heartbeatAt ? new Date(last.heartbeatAt).toISOString() : null,
    lastSpecies: lastSpecies?.species ?? null, lastSpeciesAt: lastSpecies ? new Date(lastSpecies.last).toISOString() : null, speciesWeek: data.heardWeek, href: `/places/${stored.slug}/node`,
  };
  // every other node on the globe too, dimmer; this place's own signal carries the point this viewer may see
  const others = await nodeSignals(data.now);
  const allSignals: NodeSignal[] = [signal, ...others.filter((o) => o.slug !== stored.slug)];
  const soilColors = [["#3b82c4", "#d9822b"], ["#1b3f6b", "#8a3b12"], ["#6ba3d6", "#e8a86b"]];
  const tiles: { label: string; value: string; sub: string; dot?: keyof typeof STATUS_BG }[] = [
    { label: "Last heard", value: last.heardAt ? ago(last.heardAt, data.now) : "never", sub: last.heardAt ? `${STATUS_TEXT[status]} · ${fmtTime(last.heardAt, data.zone)}` : "nothing received yet", dot: status },
    { label: "Battery", value: last.battV !== null ? `${last.battV.toFixed(2)} V` : "no reading", sub: last.battSrc === "mppt" ? "at the charge controller" : last.battSrc === "wittypi" ? "at the Witty Pi, a few tenths under the battery" : "on the desk the box runs on USB" },
    { label: "Inside the box", value: last.boxTempC !== null ? `${last.boxTempC.toFixed(1)} °C` : last.cpuTempC !== null ? `${last.cpuTempC.toFixed(0)} °C` : "no reading", sub: last.cpuTempC !== null && last.boxTempC !== null ? `processor ${last.cpuTempC.toFixed(0)} °C` : last.boxTempC === null && last.cpuTempC !== null ? "processor" : "" },
    { label: "Drawing", value: last.piW !== null ? `${last.piW.toFixed(1)} W` : "no reading", sub: last.pvW !== null ? `panel giving ${last.pvW.toFixed(0)} W` : last.diskFreeMb !== null ? `${(last.diskFreeMb / 1000).toFixed(0)} GB free on the card` : "" },
    { label: "Mobile network", value: last.network ? last.network.name : "no 4G seen", sub: last.network ? [last.network.rsrp !== null ? `${last.network.rsrp} dBm` : last.network.rssi !== null ? `${last.network.rssi} dBm` : "", last.unsent ? `${last.unsent} posts still queued` : ""].filter(Boolean).join(" · ") : "the stick had no network at the last post" },
    { label: "Heard today", value: `${data.heardToday} species`, sub: `${data.detectionsToday} detection${data.detectionsToday === 1 ? "" : "s"} · ${data.heardWeek} species this week` },
  ];
  const q = (r: string, i: string = indexRange) => `/places/${stored.slug}/node?range=${r}&index=${i}`;
  const soilProbes = data.soil.filter((p) => p.vwc.length || p.tempC.length || p.last);
  const chartProps = { from: data.from, to: data.to, zone: data.zone, night: data.night };
  const latest = index.latest;
  const unknownCount = latest ? latest.readings.filter((r) => r.direction === "UNKNOWN").length : 7;
  const satSinceYear = index.satSince ? new Date(index.satSince).getUTCFullYear() : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="text-xs text-muted">
        <Link href="/places" className="underline">Places</Link> / {stored.public || exact ? <Link href={`/places/${stored.slug}`} className="underline">{stored.slug}</Link> : stored.slug} / node
      </div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3"><span className={`inline-block w-3.5 h-3.5 rounded-full ${STATUS_BG[status]} ${status === "live" ? "sig-glow" : ""}`} />Life Node at {stored.name}</h1>
          <p className="text-sm text-muted mt-1 max-w-3xl">What the box measured and how it was doing, over time. Nothing here is modelled: every point is a post the node made. Times are local to the place ({data.zone}); the grey bands are nights.{point.radiusM ? ` The location is shown to within ${(point.radiusM / 1000).toFixed(0)} km.` : ""}</p>
        </div>
        <div className="flex gap-1 text-sm">
          {RANGES.map((r) => <Link key={r.key} href={q(r.key)} className={`rounded-full px-3 py-1 border ${r.key === range ? "bg-foreground text-white border-foreground" : "border-line bg-white hover:border-accent"}`}>{r.label}</Link>)}
        </div>
      </div>

      <LastHeard items={heard} now={data.now} zone={data.zone} />

      <section className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Life index</h2>
            <p className="text-sm text-muted max-w-3xl">One verdict for this place, read from three streams on one timeline. The seven readings are never summed: the weakest decides, and a stream that has not spoken yet makes the verdict <em>insufficient</em>, on purpose. The satellite has watched since {satSinceYear ?? "the archive began"}; sound and soil began when the node arrived.</p>
          </div>
          <div className="flex gap-1 text-sm">
            {INDEX_RANGES.map((r) => <Link key={r.key} href={q(range, r.key)} className={`rounded-full px-3 py-1 border ${r.key === indexRange ? "bg-foreground text-white border-foreground" : "border-line bg-white hover:border-accent"}`}>{r.label}</Link>)}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-line bg-white p-3">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <div className={`rounded-md text-white px-3 py-1.5 ${VERDICT_BG[latest?.verdict ?? "insufficient"]}`}>
              <span className="text-xs uppercase tracking-wide opacity-80 mr-2">Verdict{latest ? ` · ${latest.period}` : ""}</span>
              <span className="font-semibold capitalize">{latest ? (latest.verdict === "insufficient" ? "Insufficient data" : latest.verdict) : "Not yet computed"}</span>
            </div>
            <div className="text-xs text-muted">{latest ? (unknownCount ? `${unknownCount} of 7 readings still unknown: ${latest.reason.replace(/^unknown: /, "")}` : latest.reason) : "the worker computes the readings once the streams have arrived"}</div>
          </div>
          <LifeIndexChart data={index} />
          {latest && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {latest.readings.map((r) => (
                <span key={r.dimension} title={r.note ?? undefined} className={`inline-flex items-baseline gap-1 rounded-full border px-2.5 py-0.5 text-xs ${DIR_CLASS[r.direction] ?? DIR_CLASS.UNKNOWN}`}>
                  <span className="font-medium">{DIM_LABEL[r.dimension] ?? r.dimension}</span>
                  <span>{r.direction.toLowerCase()}</span>
                  {r.direction !== "UNKNOWN" && <span className="opacity-70">· {Math.round(r.confidence * 100)}%</span>}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Satellite: {index.satTotal} clear Sentinel-2 scenes{satSinceYear ? ` since ${satSinceYear}` : ""}, computed here from Copernicus data. Sound: species recognised in the box (BirdNET-Go); only names leave the field. Soil: moisture and temperature from the probe at {index.soilDepthCm ?? "?"} cm; the activity in the readout is what the weather allows soil life to do (Q10 of 2, moisture from water-filled pore space or an optimum of {index.optimumVwc.toFixed(0)}% from the soil texture); the cycling reading takes its direction from lab samples or a flux probe, not from this. Method: <Link className="underline" href="/docs/spec">the spec</Link>.</p>
        </div>
      </section>

      <div className="mt-6 rounded-xl border border-line bg-white p-3 md:p-4 grid lg:grid-cols-5 gap-4 overflow-hidden">
        <div className="lg:col-span-3 relative">
          <Globe signals={allSignals} focus={{ lat: point.lat, lon: point.lon, name: stored.name }} height={420} now={data.now} />
          <div className="absolute bottom-0 left-1 right-1 text-[11px] leading-snug text-muted">Every post travels from the node to the oracle in Nuremberg; the rings run while the node is being heard. Drag to turn. Land from Natural Earth.</div>
        </div>
        <div className="lg:col-span-2 grid grid-cols-2 gap-3 content-start">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-line bg-background p-3">
              <div className="text-xs text-muted">{t.label}</div>
              <div className="text-lg font-semibold mt-0.5 flex items-center gap-2">{t.dot && <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_BG[t.dot]}`} />}{t.value}</div>
              {t.sub && <div className="text-xs text-muted mt-0.5">{t.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <Collapsible summary={<><span className="font-semibold">Where it stands</span> <span className="text-muted">· {point.radiusM ? `somewhere in a circle of ${(point.radiusM / 1000).toFixed(0)} km; the exact spot is for the place's owner` : exact && stored.locationHidden ? "the exact spot, because this is your place" : "the exact spot"}</span></>}>
          <LifeMap height="360px" center={[point.lat, point.lon]} zoom={point.radiusM ? (point.radiusM > 3000 ? 8 : 10) : 13} signals={[signal]} focus={exact ? (place.geometry as unknown as GeoJSON.Geometry) : null} />
        </Collapsible>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Heartbeats</h2>
        <p className="text-sm text-muted">Every post the box made. It posts three minutes after a start, every three hours after that, and once more when it switches itself off. A silence after a shutdown is sleep; a silence without one means a post went missing.</p>
        <div className="mt-3 rounded-lg border border-line bg-white p-3"><HeartbeatStrip beats={data.beats} gaps={data.gaps} now={data.now} {...chartProps} /></div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Soil</h2>
        <p className="text-sm text-muted">{soilProbes.length ? `${soilProbes.length} probe${soilProbes.length === 1 ? "" : "s"}, read every twenty minutes and sent with the next post. On a desk a probe in the air reads 0% moisture.` : "No soil probe has reported yet."}</p>
        {soilProbes.length > 0 && (
          <div className="mt-3 grid lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-line bg-white p-3">
              <div className="text-sm font-medium mb-1">Moisture, % of volume</div>
              <SeriesChart {...chartProps} yMin={0} decimals={1} series={soilProbes.map((p, i) => ({ name: `${p.depthCm ?? "?"} cm`, color: soilColors[i % soilColors.length][0], points: p.vwc, unit: "%" }))} empty="No moisture readings in this range." />
            </div>
            <div className="rounded-lg border border-line bg-white p-3">
              <div className="text-sm font-medium mb-1">Temperature, °C</div>
              <SeriesChart {...chartProps} decimals={1} series={soilProbes.map((p, i) => ({ name: `${p.depthCm ?? "?"} cm`, color: soilColors[i % soilColors.length][1], points: p.tempC, unit: " °C" }))} empty="No temperature readings in this range." />
            </div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">The box itself</h2>
        <p className="text-sm text-muted">From the heartbeat: the battery it runs on, how warm it is inside, and what it draws. The battery is a 12.8 V LiFePO4; under 12.8 V the last tenth of the charge is left, at 12.6 V the node switches itself off to keep it, and above 13.2 V, with the panel charging, it starts again.</p>
        <div className="mt-3 grid lg:grid-cols-3 gap-4">
          <div className="rounded-lg border border-line bg-white p-3">
            <div className="text-sm font-medium mb-1">Battery, V</div>
            <SeriesChart {...chartProps} decimals={2} series={[{ name: "battery", color: "#2f6b3a", points: data.box.battV, unit: " V" }]} guides={[{ y: 12.6, label: "off, 12.6 V" }, { y: 13.2, label: "on again, 13.2 V", color: "#2f6b3a" }]} empty="No battery reading yet: on the desk the box runs on USB." />
          </div>
          <div className="rounded-lg border border-line bg-white p-3">
            <div className="text-sm font-medium mb-1">Temperature, °C</div>
            <SeriesChart {...chartProps} decimals={1} series={[{ name: "in the box", color: "#d9822b", points: data.box.boxTempC, unit: " °C" }, { name: "processor", color: "#8a3b12", points: data.box.cpuTempC, unit: " °C", dash: "4 3" }]} guides={[{ y: 80, label: "the processor slows itself down from 80 °C" }]} empty="No temperature in the heartbeats yet." />
          </div>
          <div className="rounded-lg border border-line bg-white p-3">
            <div className="text-sm font-medium mb-1">Power, W</div>
            <SeriesChart {...chartProps} yMin={0} decimals={2} series={[{ name: "the box draws", color: "#6b5ca5", points: data.box.piW, unit: " W" }, ...(data.box.pvW.length ? [{ name: "the panel gives", color: "#c9a227", points: data.box.pvW, unit: " W" }] : [])]} empty="No power reading in the heartbeats yet." />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Sound</h2>
        <p className="text-sm text-muted">What the microphone recognised. Species recognition runs in the box; only the names leave the field. The grid is the last fourteen days by hour of the day, so a dawn chorus shows as a dark column.</p>
        <div className="mt-3 grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 rounded-lg border border-line bg-white p-3"><DawnChorus chorus={data.chorus} /></div>
          <div className="lg:col-span-2 rounded-lg border border-line bg-white p-3 overflow-x-auto">
            {data.species.length === 0 ? <div className="text-sm text-muted">No bird heard yet.</div> : (
              <table className="text-sm w-full">
                <thead><tr className="text-left text-muted text-xs"><th className="py-1 font-medium">Species</th><th className="font-medium text-right">today</th><th className="font-medium text-right">7 days</th><th className="font-medium text-right">all</th><th className="font-medium text-right pl-2">sure</th><th className="font-medium pl-3">last heard</th></tr></thead>
                <tbody>
                  {data.species.slice(0, 40).map((s) => (
                    <tr key={s.species} className="border-t border-line">
                      <td className="py-1 pr-2"><span className="font-medium">{s.species}</span>{s.scientific && s.scientific !== s.species ? <span className="text-muted text-xs"> {s.scientific}</span> : null}</td>
                      <td className="text-right tabular-nums">{s.today || ""}</td><td className="text-right tabular-nums">{s.week || ""}</td><td className="text-right tabular-nums">{s.total}</td>
                      <td className="text-right tabular-nums pl-2">{Math.round(s.conf * 100)}%</td><td className="pl-3 whitespace-nowrap text-muted text-xs">{fmtTime(s.last, data.zone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.tests ? <p className="mt-2 text-xs text-muted">Not counted: {data.tests.n} test detection{data.tests.n === 1 ? "" : "s"} from {dayLabel(data.tests.first, data.zone)} to {dayLabel(data.tests.last, data.zone)}, made while the node was built. They show the box worked; they say nothing about the place.</p> : null}
          </div>
        </div>
      </section>

      <section className="mt-8 text-sm text-muted">
        <div>{data.devices.map((d) => `${d.kind === "SOUND" ? "Microphone" : d.kind === "SOIL" ? `Soil probe ${d.depthCm ?? "?"} cm` : d.kind}: ${d.model}, last seen ${d.lastSeenAt ? ago(d.lastSeenAt, data.now) : "never"}`).join(" · ")}</div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <a className="underline" href={`/api/v1/places/${stored.slug}/node?range=${range}`}>This page as JSON</a>
          <Link className="underline" href="/map">All nodes on the map</Link>
          <Link className="underline" href="/node/logbook">Logbook of node 1</Link>
          <Link className="underline" href="/node">Build one</Link>
        </div>
      </section>
    </div>
  );
}
