import Link from "next/link";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";

export default async function Home() {
  const [places, obs, devices] = await Promise.all([prisma.place.count(), prisma.satelliteObs.count(), prisma.device.count()]).catch(() => [0, 0, 0]);
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 md:py-24 grid md:grid-cols-5 gap-10 items-start">
        <div className="md:col-span-3">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05]">Is life thriving here?<br />Let the place answer.</h1>
          <p className="mt-6 text-lg text-muted leading-relaxed max-w-2xl">
            The life oracle is an open standard and open software that reads how a piece of land is doing from three cheap streams: satellite, a sound recorder and a soil probe. Seven readings, one verdict, no scheduled sampling. Built so that farmers, funders, verifiers and software agents can all check the same truth.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/map" className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium">Open the map</Link>
            <Link href="/places/new" className="px-4 py-2 rounded-md border border-line text-sm font-medium">Register a place</Link>
            <Link href="/docs/greenpaper" className="px-4 py-2 rounded-md border border-line text-sm font-medium">Read the green paper</Link>
          </div>
        </div>
        <div className="md:col-span-2 grid grid-cols-3 gap-3 text-center">
          {[[places, "places"], [obs, "satellite observations"], [devices, "devices"]].map(([n, l]) => (
            <div key={String(l)} className="rounded-lg border border-line p-4 bg-white">
              <div className="text-2xl font-semibold">{String(n)}</div>
              <div className="text-xs text-muted mt-1">{String(l)}</div>
            </div>
          ))}
          <div className="col-span-3 rounded-lg border border-line p-4 bg-white text-left text-sm text-muted">
            Version 0.1. Satellite stream live for every registered place (Sentinel-2, 2019 to now). Sound and soil streams accept data today; their readings turn from <em>unknown</em> to a direction after the first full year.
          </div>
        </div>
      </section>

      <section className="py-10 grid md:grid-cols-3 gap-6">
        {[
          ["Satellite", "Free, every five days, archive back to 2017. Greenness, season length, bare-soil days, and how fast a place recovered from the droughts of 2018, 2020 and 2022. Computed here from Copernicus Sentinel-2 for any polygon on Earth."],
          ["Sound recorder", "One box per ~20 hectares, installed once. Birds and bats are the insect sensor; breeding song is the renewal signal; tractor noise is the management signal. Detections arrive through one API call."],
          ["Soil probe", "One probe per field, installed once. Moisture and temperature give the rate at which the soil is breathing. LoRaWAN uplinks from The Things Network land here through a webhook."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-lg border border-line p-5 bg-white">
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-2 text-sm text-muted leading-relaxed">{b}</p>
          </div>
        ))}
      </section>

      <section className="py-10">
        <h2 className="text-2xl font-semibold">Start where you stand</h2>
        <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {[
            ["Steward (farmer, land manager)", "Register your place, get the satellite readings today, then add a recorder and a probe.", "/docs/guide-steward"],
            ["Installer / node host", "Buy, mount and connect the hardware. Exact models, prices, heights, depths.", "/docs/hardware"],
            ["Verifier", "Random and triggered visits. What to look at, what to record, how to file it.", "/docs/roles"],
            ["Funder, buyer, registry", "Read verdicts by API, pin a method version, let life set the carbon sampling burden.", "/docs/api"],
            ["Researcher / methodologist", "Propose changes to the seven readings. Everything is open and reproducible.", "/docs/spec"],
            ["Software agent", "Machine-readable verdicts and evidence at /api/v1. Close your loop against life.", "/api/v1/openapi.json"],
          ].map(([t, b, h]) => (
            <Link key={t} href={h} className="rounded-lg border border-line p-4 bg-white hover:border-accent">
              <div className="font-medium">{t}</div>
              <div className="mt-1 text-muted">{b}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
