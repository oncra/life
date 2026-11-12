"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ago, clockLabel, dayLabel, dayStart, fmtTime } from "@/lib/clock";
import type { HeardClip, HeardRow } from "@/lib/node";

/** The last species the microphone recognised, newest first, each as a cut-out standing on the page. The pictures
 * come from Wikimedia Commons with the background removed by the worker; the credits are under the row. A tap on a
 * bird plays its newest clip (`heardClips`), one bird at a time, and a second tap stops it. A phone shows four, two
 * by two, because five leave one alone on the last row; from `lg` all five stand in one row. */
export default function LastHeard({ items, clips, now, zone }: { items: HeardRow[]; clips: Record<string, HeardClip>; now: number; zone: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = useRef<string | null>(null);
  const bar = useRef<HTMLSpanElement | null>(null);
  const frame = useRef(0);
  // the bird playing, and whether its sound has started (the clip is still loading until then)
  const [on, setOn] = useState<{ key: string; sounding: boolean } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    const a = audio.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
    }
  }, []);

  if (items.length === 0) return null;

  function reset() {
    cancelAnimationFrame(frame.current);
    current.current = null;
    setOn(null);
  }
  function stop() {
    const a = audio.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    reset();
  }
  function tick() {
    const a = audio.current;
    if (!a || !current.current) return;
    if (bar.current && Number.isFinite(a.duration) && a.duration > 0) bar.current.style.transform = `scaleX(${Math.min(1, a.currentTime / a.duration)})`;
    frame.current = requestAnimationFrame(tick);
  }
  function player(): HTMLAudioElement {
    if (audio.current) return audio.current;
    const a = new Audio();
    a.preload = "auto";
    a.addEventListener("playing", () => {
      if (!current.current) return;
      setOn({ key: current.current, sounding: true });
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(tick);
    });
    a.addEventListener("ended", reset);
    a.addEventListener("error", () => {
      const key = current.current;
      if (!key || !a.getAttribute("src")) return;
      setFailed((f) => [...f, key]);
      reset();
    });
    audio.current = a;
    return a;
  }
  function toggle(key: string, clip: HeardClip) {
    if (current.current === key) return stop();
    // made and started inside the tap: Safari on a phone plays sound only from a gesture
    const a = player();
    a.pause();
    cancelAnimationFrame(frame.current);
    current.current = key;
    setOn({ key, sounding: false });
    a.src = `/api/clips/${clip.id}/audio`;
    a.play().catch((e: unknown) => {
      // a newer tap took the player over: not a failure
      if ((e as { name?: string })?.name === "AbortError" || current.current !== key) return;
      setFailed((f) => [...f, key]);
      reset();
    });
  }

  const credits = items.filter((i) => i.image);
  // below lg the row holds four; the fifth bird and its credit come back with the fifth column
  const wide = (i: number) => (i >= 4 ? "hidden lg:block" : "");
  const n = items.length;
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Last heard here</h2>
        <span className="text-xs text-muted">
          {n === 1 ? "the most recent species" : n > 4 ? <>the <span className="lg:hidden">4</span><span className="hidden lg:inline">{n}</span> most recent species, newest first</> : `the ${n} most recent species, newest first`}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {items.map((it, i) => {
          const sci = it.scientific && it.scientific !== it.species ? it.scientific : null;
          const clip = failed.includes(it.key) ? undefined : clips[it.key];
          const active = on?.key === it.key;
          const label = clip ? `${active ? "Stop" : "Play"} ${it.species}: the newest clip, ${fmtTime(clip.t, zone)}, ${clip.expansion ? `slowed down ${clip.expansion} times` : `${Math.round(clip.confidence * 100)}% sure`}` : undefined;
          // the button covers the tile, so its tooltip also carries the last detection the line below names
          const tip = label && `${label}\nLast heard ${fmtTime(it.t, zone)}, ${Math.round(it.confidence * 100)}% sure`;
          return (
            <figure key={it.key} className={`group relative overflow-hidden rounded-xl border bg-white px-3 pt-7 pb-3 text-center transition-colors ${active ? "border-accent" : clip ? "border-line hover:border-accent" : "border-line"} ${wide(i)}`}>
              {clip && (
                <span aria-hidden className={`absolute top-1.5 right-1.5 h-[22px] w-[22px] rounded-full border flex items-center justify-center transition-colors ${active ? "bg-accent border-accent" : "bg-white border-line group-hover:border-accent"}`}>
                  {active ? <Sounding on={on.sounding} /> : <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-accent translate-x-[1px]"><path d="M2 1.2v7.6L8.6 5z" /></svg>}
                </span>
              )}
              <div className="h-36 flex items-end justify-center">
                {it.image ? (
                  <Image src={`/api/species-image/${it.image.id}.webp`} alt={it.species} width={it.image.width || 400} height={it.image.height || 300} unoptimized priority={i < 3} className={`max-h-36 w-auto max-w-full object-contain drop-shadow-[0_12px_12px_rgba(27,31,26,0.22)] transition-transform duration-300 origin-bottom ${active ? "scale-[1.04]" : ""}`} />
                ) : (
                  <div className="h-24 w-24 rounded-full bg-[#eef2ea] text-accent flex items-center justify-center text-3xl font-semibold" aria-hidden title={it.status === "failed" ? "no picture found for this species" : "the picture is on its way"}>{it.species.slice(0, 1)}</div>
                )}
              </div>
              <figcaption className="mt-3">
                <div className="font-medium leading-tight">{it.species}</div>
                {sci && <div className="text-xs text-muted italic leading-tight mt-0.5">{sci}</div>}
                {active && clip ? (
                  // while it plays, the line says when this clip was heard and how sure the detector was of it
                  <div className="text-xs text-accent mt-1">{clipWhen(clip.t, now, zone)} · {clip.expansion ? `${clip.expansion}× slower` : `${Math.round(clip.confidence * 100)}% sure`}</div>
                ) : (
                  <div className="text-xs text-muted mt-1" title={fmtTime(it.t, zone)}>{failed.includes(it.key) ? "the clip would not play" : `${ago(it.t, now)} · ${Math.round(it.confidence * 100)}% sure`}</div>
                )}
              </figcaption>
              {active && <span ref={bar} aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-accent origin-left" style={{ transform: "scaleX(0)" }} />}
              {clip && <button type="button" onClick={() => toggle(it.key, clip)} aria-label={label} title={tip} className="absolute inset-0 rounded-xl cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" />}
            </figure>
          );
        })}
      </div>
      {credits.length > 0 && (
        <p className="mt-2 text-[11px] text-muted leading-snug">
          Photos from Wikimedia Commons, cut out here: {credits.map((c, i) => (
            <span key={c.key} className={items.indexOf(c) >= 4 ? "hidden lg:inline" : ""}>{i > 0 ? " · " : ""}{c.species}{c.image!.sourceUrl ? <> by <a className="underline" href={c.image!.sourceUrl}>{c.image!.author ?? "unknown"}</a></> : c.image!.author ? ` by ${c.image!.author}` : ""}{c.image!.license ? <> ({c.image!.licenseUrl ? <a className="underline" href={c.image!.licenseUrl}>{c.image!.license}</a> : c.image!.license})</> : ""}</span>
          ))}
        </p>
      )}
    </section>
  );
}

/** When a clip was heard, short enough for the tile's line: "08:36" today, "Tue 14:36" this week, else "3 Nov". */
function clipWhen(t: number, now: number, zone: string): string {
  const days = Math.round((dayStart(now, zone) - dayStart(t, zone)) / 86400e3);
  const day = dayLabel(t, zone);
  return days <= 0 ? clockLabel(t, zone) : days < 7 ? `${day.slice(0, 3)} ${clockLabel(t, zone)}` : day.slice(4);
}

/** Three bars that move while the bird sounds and stand still while its clip loads. */
function Sounding({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex h-2.5 items-end gap-[2px] ${on ? "" : "opacity-60"}`}>
      {[0, 1, 2].map((b) => <span key={b} className={`w-[2px] h-full rounded-full bg-white origin-bottom ${on ? "sound-bar" : "scale-y-50"}`} style={on ? { animationDelay: `${b * 0.18}s` } : undefined} />)}
    </span>
  );
}
