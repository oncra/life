import Link from "next/link";
import type { ReactNode } from "react";
import LineIcon from "./LineIcon";

// Why the Life Node is different, in one place for the home page and the build guide (/node, where
// lifenodes.org lands). Every line here is a fact about node v1 as built: power and the battery guard
// in node/image/life-wittypi.sh, the alerts in src/lib/alerts.ts and src/lib/battery.ts, the parts
// and the price on the kit page, the comparison under "How it compares" there. Change the node,
// change this. Each point carries a line icon (LineIcon's 24 px grid) so the six read at a glance.

export const NODE_LEAD =
  "A Life Node needs nothing from the place it stands in: no power line, no WiFi, no farm network, and nobody coming by to change batteries or memory cards. It hears, measures and reports on its own, so the network grows one post at a time instead of one installation at a time.";

const POINTS: { title: string; icon: ReactNode; body: ReactNode }[] = [
  {
    title: "Its own power",
    // the sun
    icon: <><circle cx="12" cy="12" r="3.6" /><path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.55 1.55M16.65 16.65l1.55 1.55M5.8 18.2l1.55-1.55M16.65 7.35l1.55-1.55" /></>,
    body: "A 40 W panel and a 20 Ah battery. A small scheduler wakes the box for its listening hours and puts it to sleep after. Below 12.6 V it shuts itself down cleanly, and it starts again once the sun has lifted the battery above 13.2 V.",
  },
  {
    title: "Its own 4G",
    // phone signal
    icon: <path d="M4.5 19.5V16M9.5 19.5V12.5M14.5 19.5V9M19.5 19.5V5" />,
    body: "One 4G stick on a €13 SIM that lasts ten years: no WiFi, no gateway, no monthly fee. Where a phone has signal, a node can stand, in the middle of a field or a food forest. It reports what it heard, and how it is doing, several times a day.",
  },
  {
    title: "It names what it hears",
    // a bird singing
    icon: <><path d="M15.56 9.12L13.7 8.45A2.2 2.2 0 0 0 9.58 8.45C7.96 9.12 6.44 10.96 5.72 12.72L2.2 15.28L2.84 16.4L6.52 15.12C9.4 16.72 13.96 14.48 13.81 9.58Z" /><path d="M11.96 8.64h.01" /><path d="M8.6 15.5v2.9M10.8 15.4v3" /><path d="M17.4 7.28a2.6 2.6 0 0 1 0 3.68M19.1 5.58a5 5 0 0 1 0 7.08" /></>,
    body: "BirdNET runs inside the box, so only the names of the birds and bats leave the field, never the sound. That keeps the people on the land private and the data to a few kilobytes a day.",
  },
  {
    title: "More than birds",
    // a bat
    icon: <path d="M12 8.1L13.3 6.5L13.9 9C16.2 7.4 19.2 6.6 21.6 6.6C20.6 8.4 20.1 10.4 20.2 12.6C19.1 11.4 17.4 11.4 16.6 13C15.8 12.2 14.5 12.6 14.1 14.6C13.4 15.2 12.6 16.2 12 17.4C11.4 16.2 10.6 15.2 9.9 14.6C9.5 12.6 8.2 12.2 7.4 13C6.6 11.4 4.9 11.4 3.8 12.6C3.9 10.4 3.4 8.4 2.4 6.6C4.8 6.6 7.8 7.4 10.1 9L10.7 6.5Z" />,
    body: "Birds from dawn, bats after sunset with an ultrasonic microphone, and two probes for the moisture and warmth of the soil at 10 and 30 cm. The Life Oracle adds what satellites see: three witnesses, one verdict.",
  },
  {
    title: "It watches over itself",
    // an alarm light
    icon: <><path d="M7 18v-5a5 5 0 0 1 10 0v5" /><rect x="5" y="18" width="14" height="2.6" rx="1" /><path d="M12 3v2.1M4.6 5.9l1.5 1.5M19.4 5.9l-1.5 1.5M2.6 12.4h2M19.4 12.4h2" /><path d="M12 11.8v3.2" /></>,
    body: "A 100 dB siren when the panel is taken or the box tips over, and a message to the owner within minutes. The oracle also raises a flag when a node moves to another cell tower, goes quiet for 36 hours or runs low on battery.",
  },
  {
    title: "Open, and cheap enough to repeat",
    // a euro coin
    icon: <><circle cx="12" cy="12" r="8.4" /><path d="M15.5 9.2a3.6 3.6 0 1 0 0 5.6M8.1 11h5.2M8.1 13h5.2" /></>,
    body: (
      <>
        About €809 in parts, the SIM for ten years included: about €81 a year, with no routine visits. Every part, shop and price is published, and the software and the build guide are open. Where the other listening boxes fit best, and what each costs with its visits counted: <Link className="underline" href="/docs/kit#how-it-compares">how it compares</Link>.
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
          <div className="flex items-center gap-3">
            <span className={`shrink-0 inline-flex items-center justify-center rounded-full bg-[#eef2ea] text-accent ${compact ? "h-9 w-9" : "h-10 w-10"}`}>
              <LineIcon className={compact ? "h-5 w-5" : "h-6 w-6"}>{p.icon}</LineIcon>
            </span>
            <div className="font-medium">{p.title}</div>
          </div>
          <div className={`mt-2 text-muted leading-relaxed ${compact ? "text-[0.9rem]" : "text-sm"}`}>{p.body}</div>
        </li>
      ))}
    </ul>
  );
}
