import Link from "next/link";
import Image from "next/image";
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
            Restoring a piece of land is not the hard part. Proving that it worked is, and that cost is what keeps a twelve-hectare farmer out of nature finance. The life oracle is an open standard and open software that reads how a piece of land is doing from three cheap streams: satellite, a sound recorder and a soil probe. Seven readings, one verdict, no scheduled sampling. Built so that farmers, funders, verifiers and software agents can all check the same truth.
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

      <section className="py-10">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            ["Satellite", "/img/stream-satellite-horaholm.webp", "Sentinel-2 true colour of Horaholm, a 55 ha arable place registered on this site, outlined in white among the fields around it", "Free, every five days, archive back to 2017. Greenness, season length, bare-soil days, and how fast a place recovered from the droughts of 2018, 2020 and 2022. Computed here from Copernicus Sentinel-2 for any polygon on Earth."],
            ["Sound recorder", "/img/stream-sound-skylark.webp", "A skylark in full song, beak open", "One box per ~20 hectares, installed once. Birds and bats are the insect sensor; breeding song is the renewal signal; tractor noise is the management signal. Species recognition runs in the box, so only detections leave the field."],
            ["Soil probe", "/img/stream-soil-probes.webp", "Two wired soil probes pushed horizontally into the wall of a soil pit at two depths, cable running up to the box", "One probe per field, installed once. Moisture and temperature give the rate at which the soil is breathing. In the standard kit the probes are wired into the same box, which carries both streams over its own 4G link. LoRaWAN uplinks through The Things Stack are accepted too."],
          ].map(([t, src, alt, b]) => (
            <div key={t} className="rounded-lg border border-line bg-white overflow-hidden flex flex-col">
              <Image src={src} alt={alt} width={1200} height={675} className="w-full aspect-video object-cover" priority={t === "Satellite"} sizes="(min-width: 768px) 33vw, 100vw" />
              <div className="p-5">
                <h2 className="font-semibold">{t}</h2>
                <p className="mt-2 text-sm text-muted leading-relaxed">{b}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted leading-relaxed">
          Images. Satellite: Sentinel-2 scene S2A_32ULE_20250612, 12 June 2025, 0.01% cloud, computed here from Copernicus data, the parcel drawn from its registered boundary (<Link className="underline" href="/places/horaholm-oncra-hor-l-001-hornhuizen">Horaholm</Link>). Skylark: caroline legg, <a className="underline" href="https://commons.wikimedia.org/wiki/File:Singing_Skylark_(51143368485).jpg">CC BY 2.0</a>. Soil probes: MKose, <a className="underline" href="https://commons.wikimedia.org/wiki/File:EAgronom_4okt2023_L-1120.jpg">CC BY 4.0</a>, cropped.
        </p>
      </section>

      <section className="py-10">
        <div className="rounded-lg border border-line bg-white overflow-hidden grid md:grid-cols-2">
          <Image
            src="/img/life-node-impression.webp"
            alt="Impression of the Life node in an agroforestry alley: a small matt green box on a short square wooden post under a tilted solar panel, with two grey probe leads running into the ground, a skylark singing on the corner of the panel and a hare sitting further down the alley"
            width={1600}
            height={900}
            className="w-full h-full object-cover min-h-[220px]"
            sizes="(min-width: 768px) 50vw, 100vw"
          />
          <div className="p-6 md:p-8 flex flex-col justify-center">
            <h2 className="text-2xl font-semibold">One box on one post</h2>
            <p className="mt-3 text-sm text-muted leading-relaxed">
              Two of the three streams come out of a single device. Inside the box a small computer listens and names the birds itself, so only detections leave the field; two probes wired into the same box read moisture and temperature at 10 and 30 cm; one 4G stick on a twelve-euro ten-year SIM carries both. A solar panel doubles as its roof. Nothing stands higher than 1,090 mm, which is how it disappears into a standing crop, and there is no farm network, no gateway and no subscription anywhere in it. About €687 in parts, with the bill of materials, the order list and the failure modes published.
            </p>
            <p className="mt-3 text-xs text-muted leading-relaxed">
              The picture is an impression of the design, not a photograph: the kit is ordered and nothing has been built yet.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/docs/kit" className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium">See the kit</Link>
              <Link href="/docs/build" className="px-4 py-2 rounded-md border border-line text-sm font-medium">Follow the build</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-10">
        <h2 className="text-2xl font-semibold">Start where you stand</h2>
        <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {[
            ["Steward (farmer, land manager)", "Register your place, get the satellite readings today, then add a recorder and a probe.", "/docs/guide-steward"],
            ["Installer / node host", "Build and mount the standard node: one solar 4G box on a post, no farm network. Bill of materials, prices, order list.", "/docs/kit"],
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
