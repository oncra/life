import Image from "next/image";
import { ago, fmtTime } from "@/lib/clock";
import type { HeardRow } from "@/lib/node";

/** The last species the microphone recognised, newest first, each as a cut-out standing on the page. The pictures
 * come from Wikimedia Commons with the background removed by the worker; the credits are under the row. */
export default function LastHeard({ items, now, zone }: { items: HeardRow[]; now: number; zone: string }) {
  if (items.length === 0) return null;
  const credits = items.filter((i) => i.image);
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Last heard here</h2>
        <span className="text-xs text-muted">the {items.length === 1 ? "most recent species" : `${items.length} most recent species, newest first`}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map((it, i) => {
          const sci = it.scientific && it.scientific !== it.species ? it.scientific : null;
          return (
            <figure key={it.species} className="rounded-xl border border-line bg-white px-3 pt-4 pb-3 text-center">
              <div className="h-36 flex items-end justify-center">
                {it.image ? (
                  <Image src={`/api/species-image/${it.image.id}.webp`} alt={it.species} width={it.image.width || 400} height={it.image.height || 300} unoptimized priority={i < 3} className="max-h-36 w-auto max-w-full object-contain drop-shadow-[0_12px_12px_rgba(27,31,26,0.22)]" />
                ) : (
                  <div className="h-24 w-24 rounded-full bg-[#eef2ea] text-accent flex items-center justify-center text-3xl font-semibold" aria-hidden title={it.status === "failed" ? "no picture found for this species" : "the picture is on its way"}>{it.species.slice(0, 1)}</div>
                )}
              </div>
              <figcaption className="mt-3">
                <div className="font-medium leading-tight">{it.species}</div>
                {sci && <div className="text-xs text-muted italic leading-tight mt-0.5">{sci}</div>}
                <div className="text-xs text-muted mt-1" title={fmtTime(it.t, zone)}>{ago(it.t, now)} · {Math.round(it.confidence * 100)}% sure</div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {credits.length > 0 && (
        <p className="mt-2 text-[11px] text-muted leading-snug">
          Photos from Wikimedia Commons, cut out here: {credits.map((c, i) => (
            <span key={c.species}>{i > 0 ? " · " : ""}{c.species}{c.image!.sourceUrl ? <> by <a className="underline" href={c.image!.sourceUrl}>{c.image!.author ?? "unknown"}</a></> : c.image!.author ? ` by ${c.image!.author}` : ""}{c.image!.license ? <> ({c.image!.licenseUrl ? <a className="underline" href={c.image!.licenseUrl}>{c.image!.license}</a> : c.image!.license})</> : ""}</span>
          ))}
        </p>
      )}
    </section>
  );
}
