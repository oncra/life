import Link from "next/link";
import type { ReactNode } from "react";

// Why the Life Node is different, in one place for the home page and the build guide (/node, where
// lifenodes.org lands). Every line here is a fact about node v1 as built: power and the battery guard
// in node/image/life-wittypi.sh, the alerts in src/lib/alerts.ts and src/lib/battery.ts, the parts
// and the price on the kit page, the comparison under "How it compares" there. Change the node,
// change this.

export const NODE_LEAD =
  "A Life Node needs nothing from the place it stands in: no power line, no WiFi, no farm network, and nobody coming by to change batteries or memory cards. It hears, measures and reports on its own, so the network grows one post at a time instead of one installation at a time.";

const POINTS: { title: string; body: ReactNode }[] = [
  {
    title: "Its own power",
    body: "A 40 W panel and a 20 Ah battery. A small scheduler wakes the box for its listening hours and puts it to sleep after. Below 12.6 V it shuts itself down cleanly, and it starts again once the sun has lifted the battery above 13.2 V.",
  },
  {
    title: "Its own 4G",
    body: "One 4G stick on a €13 SIM that lasts ten years: no WiFi, no gateway, no monthly fee. Where a phone has signal, a node can stand, in the middle of a field or a food forest. It reports what it heard, and how it is doing, several times a day.",
  },
  {
    title: "It names what it hears",
    body: "BirdNET runs inside the box, so only the names of the birds and bats leave the field, never the sound. That keeps the people on the land private and the data to a few kilobytes a day.",
  },
  {
    title: "More than birds",
    body: "Birds from dawn, bats after sunset with an ultrasonic microphone, and two probes for the moisture and warmth of the soil at 10 and 30 cm. The Life Oracle adds what satellites see: three witnesses, one verdict.",
  },
  {
    title: "It watches over itself",
    body: "A tamper alarm with a 100 dB siren on the lid, the panel and tilting. The oracle raises a flag when a node moves to another cell tower, goes quiet for 36 hours or runs low on battery.",
  },
  {
    title: "Open, and cheap enough to repeat",
    body: (
      <>
        About €799 in parts, the SIM for ten years included: about €80 a year, and a visit or two a year to wipe the microphone port and the panel. Every part, shop and price is published, and the software and the build guide are open. Where the other listening boxes fit best, and what each costs with its visits counted: <Link className="underline" href="/docs/kit#how-it-compares">how it compares</Link>.
      </>
    ),
  },
];

export const NODE_SCALE =
  "Measuring networks usually grow as fast as their infrastructure and their rounds: a gateway per farm, power to every post, someone collecting cards. A Life Node brings its own power and its own connection and keeps running without anyone fetching cards or changing batteries, so adding a place means adding a post. Every node is built to the same open plan, runs the same software image and is read by the same rules, so a thousand nodes are one network, not a thousand projects.";

/** The six points as cards. `compact` for the build guide's narrower column. */
export function NodeWhy({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={`grid gap-3 list-none p-0 ${compact ? "sm:grid-cols-2" : "md:grid-cols-3 gap-4"}`}>
      {POINTS.map((p) => (
        <li key={p.title} className={`rounded-lg border border-line bg-white ${compact ? "p-3" : "p-4"}`}>
          <div className="font-medium">{p.title}</div>
          <div className={`mt-1 text-muted leading-relaxed ${compact ? "text-[0.9rem]" : "text-sm"}`}>{p.body}</div>
        </li>
      ))}
    </ul>
  );
}
