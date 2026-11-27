"use client";
import { useEffect, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { fmtTime, wall } from "@/lib/clock";
import type { DemoBird, DemoOut } from "@/lib/node-demo";

/** The node's demo board: the bird it heard last, large, the ones before it, every detection as it comes in, how the node
 * is doing and, while a demo runs, where it is now from the 4G mast it hears. It covers the whole window (a screen at a
 * stand or on a table) and polls the demo route every few seconds while the tab is visible. */

type Lang = "en" | "nl";
const T = {
  en: {
    live: "Live", listening: "Listening", awake: "Awake", on: "On", asleep: "Asleep", saving: "Saving power", quiet: "Quiet", silent: "Silent", never: "Not yet heard from",
    now: "Heard just now", before: "Heard before", feed: "Every detection", waiting: "Listening… the first bird appears here the moment the node recognises it.",
    sure: "sure", today: "species today", detections: "detections today", week: "species this week",
    battery: "Battery", power: "Uses", cpu: "Processor", box: "Box", signal: "4G signal", link: "Online via", up: "Running for",
    where: "Where the node is now", fromMast: "from the 4G mast it hears", mastWait: "Waiting for the 4G mast to be placed…", hidden: "Its exact place stays private; this is the area it belongs to.",
    demoOn: "Demo on until", start: "Start demo (2 h)", stop: "End demo", test: "test", by: "Photos: Wikimedia Commons",
    wifi: "WiFi", lan: "cable", "4g": "4G", unknownMast: "The open mast database does not know this mast yet.",
    liveVia: "Live via", notLive: "Not live", noNews: "No word from the node yet", lastUpdate: "last update", lastReport: "last report",
    onSince: "on since", nextReport: "next report expected around", wifiSignal: "WiFi signal", via: "via",
    lastHeard: "Last heard", listeningSince: "Listening since", noBirdYet: "no bird recognised yet. The first one appears here the moment it does.",
    offline: "The node is not sending live now: on 4G it reports every few hours, on WiFi or a cable every 20 seconds.",
    play: "Play", playing: "Playing", soundOn: "Sound on", soundOff: "Sound off", noClip: "no recording yet",
  },
  nl: {
    live: "Live", listening: "Luistert", awake: "Wakker", on: "Aan", asleep: "Slaapt", saving: "Spaart stroom", quiet: "Stil", silent: "Zwijgt", never: "Nog niets gehoord",
    now: "Net gehoord", before: "Eerder gehoord", feed: "Elke herkenning", waiting: "Luistert… de eerste vogel verschijnt hier zodra de node hem herkent.",
    sure: "zeker", today: "soorten vandaag", detections: "herkenningen vandaag", week: "soorten deze week",
    battery: "Accu", power: "Verbruik", cpu: "Processor", box: "Kast", signal: "4G-signaal", link: "Online via", up: "Draait al",
    where: "Waar de node nu is", fromMast: "uit de 4G-mast die hij hoort", mastWait: "Wacht op de plek van de 4G-mast…", hidden: "De precieze plek blijft privé; dit is het gebied waar hij hoort.",
    demoOn: "Demo aan tot", start: "Start demo (2 uur)", stop: "Demo stoppen", test: "test", by: "Foto's: Wikimedia Commons",
    wifi: "wifi", lan: "kabel", "4g": "4G", unknownMast: "De open mastdatabase kent deze mast nog niet.",
    liveVia: "Live via", notLive: "Niet live", noNews: "Nog niets van de node gehoord", lastUpdate: "laatste update", lastReport: "laatste bericht",
    onSince: "aan sinds", nextReport: "volgend bericht rond", wifiSignal: "wifi-signaal", via: "via",
    lastHeard: "Laatst gehoord", listeningSince: "Luistert sinds", noBirdYet: "nog geen vogel herkend. De eerste verschijnt hier zodra hij er een hoort.",
    offline: "De node stuurt nu niet live: over 4G meldt hij zich om de paar uur, over wifi of een kabel elke 20 seconden.",
    play: "Luister", playing: "Speelt", soundOn: "Geluid aan", soundOff: "Geluid uit", noClip: "nog geen opname",
  },
} as const;

const POLL_MS = 4000;

function name(b: DemoBird | undefined, lang: Lang): string {
  if (!b) return "";
  return (lang === "nl" && b.names?.nl) || b.species;
}
const pct = (c: number) => `${Math.round(c * 100)}%`;
const clock = (t: number, zone: string) => {
  const w = wall(t, zone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.h)}:${p(w.mi)}:${p(w.s)}`;
};
/** How long ago, to the second while it is fresh: on a demo board a bird is heard seconds ago, not "just now". */
function ago(t: number, now: number, lang: Lang): string {
  const nl = lang === "nl";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return nl ? "zojuist" : "just now";
  if (s < 60) return nl ? `${s} s geleden` : `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return nl ? `${m} min geleden` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return nl ? `${h} uur geleden` : `${h} h ago`;
  const days = Math.round(h / 24);
  return nl ? `${days} dagen geleden` : `${days} days ago`;
}
function span(ms: number, lang: Lang): string {
  const m = Math.max(0, Math.round(ms / 60e3));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} ${lang === "nl" ? "u" : "h"} ${m % 60} min`;
}

export default function DemoBoard({ initial, src, canRun, lang: firstLang }: { initial: DemoOut; src: string; canRun: boolean; lang: Lang }) {
  const [d, setD] = useState(initial);
  const [now, setNow] = useState(initial.now);
  const [lang, setLang] = useState<Lang>(firstLang);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastId = useRef<string | null>(initial.feed[0]?.id ?? null);
  // one player for the whole board; with sound on, a clip that arrives after the switch was turned on plays by itself
  // (a browser plays sound only after a tap on the page, which the switch is)
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const heardClips = useRef<Set<string>>(new Set(initial.feed.map((f) => f.clip).filter((c): c is string => !!c)));
  function play(clip: string) {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
      audio.current.onerror = () => setPlaying(null);
    }
    const a = audio.current;
    if (!a.paused && a.src.endsWith(`/api/clips/${clip}/audio`)) { a.pause(); setPlaying(null); return; }
    a.src = `/api/clips/${clip}/audio`;
    setPlaying(clip);
    a.play().catch(() => setPlaying(null));
  }
  const t = T[lang];
  const autoRef = useRef(auto);
  useEffect(() => { autoRef.current = auto; }, [auto]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(src, { cache: "no-store" });
          if (r.ok) {
            const next = (await r.json()) as DemoOut;
            if (!stop) {
              const top = next.feed[0]?.id ?? null;
              if (top && top !== lastId.current) {
                setFresh(top);
                setTimeout(() => setFresh((f) => (f === top ? null : f)), 7000);
              }
              lastId.current = top;
              setD(next);
              const newest = next.feed.find((f) => f.clip && !heardClips.current.has(f.clip));
              for (const f of next.feed) if (f.clip) heardClips.current.add(f.clip);
              if (newest?.clip && autoRef.current) play(newest.clip);
            }
          }
        } catch { /* the next round tries again */ }
      }
      if (!stop) timer = setTimeout(poll, POLL_MS);
    }
    timer = setTimeout(poll, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(timer); poll(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [src]);

  // the clock runs on the oracle's time, so "just now" is the same on every screen
  useEffect(() => {
    const skew = d.now - Date.now();
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [d.now]);

  async function run(on: boolean) {
    setBusy(true);
    try {
      await fetch(src, on ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hours: 2 }) } : { method: "DELETE" });
      const r = await fetch(src, { cache: "no-store" });
      if (r.ok) setD(await r.json());
    } finally {
      setBusy(false);
    }
  }

  const s = d.status;
  const top = d.feed[0];
  const topBird = top ? d.birds[top.key] : undefined;
  const live = s && ["live", "listening", "awake", "on"].includes(s.state);
  const others = d.heard.filter((h) => h.key !== top?.key).slice(0, 5);
  const isLive = s?.source === "live" && s.state === "live";
  const hhmm = (ms: number) => clock(ms, d.zone).slice(0, 5);
  // the bird on top is old news when it came before the node was switched on, or more than an hour ago: then the panel
  // says the node is listening, and shows that bird smaller as the last one heard
  const stale = !!top && ((s?.upSince != null && top.t < s.upSince) || now - top.t > 3600e3);

  return (
    <div className="fixed inset-0 z-[1100] overflow-y-auto bg-[#0b1510] text-[#eef3ea]" style={{ backgroundImage: "radial-gradient(ellipse at 30% 0%, rgba(47,107,58,0.35), transparent 60%), radial-gradient(ellipse at 100% 100%, rgba(30,70,90,0.25), transparent 55%)" }}>
      <div className="mx-auto max-w-[1500px] px-4 sm:px-8 py-5 min-h-full flex flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-3.5 w-3.5 rounded-full ${live ? "bg-[#5ee08a] live-glow" : "bg-[#7a7a72]"}`} />
            <div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-[#9fb5a3]">Life Node · {s ? t[s.state] : t.never}</div>
              <div className="text-lg font-semibold leading-tight">{d.place.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {d.demo.on && <span className="text-xs text-[#9fb5a3]">{t.demoOn} {fmtTime(d.demo.until!, d.zone).slice(-5)}</span>}
            {canRun && (
              <button type="button" disabled={busy} onClick={() => run(!d.demo.on)} className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${d.demo.on ? "border-white/25 hover:bg-white/10" : "bg-[#5ee08a] text-[#0b1510] border-[#5ee08a] hover:bg-[#7ff0a4]"} disabled:opacity-50`}>
                {d.demo.on ? t.stop : t.start}
              </button>
            )}
            <button type="button" onClick={() => { setAuto((a) => !a); if (!audio.current) { audio.current = new Audio(); audio.current.onended = () => setPlaying(null); } }} className={`rounded-full px-3 py-1 text-xs border transition-colors ${auto ? "bg-[#5ee08a] text-[#0b1510] border-[#5ee08a]" : "border-white/20 hover:bg-white/10"}`}>
              {auto ? t.soundOn : t.soundOff}
            </button>
            <div className="flex rounded-full border border-white/15 text-xs overflow-hidden">
              {(["nl", "en"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} className={`px-2.5 py-1 ${lang === l ? "bg-white/15" : "hover:bg-white/5"}`}>{l.toUpperCase()}</button>
              ))}
            </div>
            <div className="font-mono text-2xl tabular-nums tracking-tight">{clock(now, d.zone)}</div>
          </div>
        </header>

        <ConnStrip s={s} now={now} lang={lang} isLive={isLive} hhmm={hhmm} />

        <main className="mt-6 grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <section className="flex flex-col gap-6 min-w-0">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-8 min-h-[420px] flex flex-col">
              <div className="text-[11px] uppercase tracking-[0.25em] text-[#9fb5a3]">{stale ? t.lastHeard : t.now}</div>
              {stale && live && s?.upSince != null && (
                <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#5ee08a]/25 bg-[#5ee08a]/[0.07] px-4 py-3 text-[#c9d6cb]">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[#5ee08a] live-glow" />
                  <span><span className="font-semibold text-[#eef3ea]">{t.listeningSince} {hhmm(s.upSince)}</span>, {t.noBirdYet}</span>
                </div>
              )}
              {top && topBird ? (
                <div key={top.id} className={`flex-1 grid sm:grid-cols-[1.2fr_1fr] items-end gap-6 ${fresh === top.id ? "demo-in" : ""} ${stale ? "opacity-55 scale-[0.85] origin-bottom-left" : ""}`}>
                  <div className="relative h-[300px] sm:h-[360px] flex items-end justify-center">
                    {fresh === top.id && <span aria-hidden className="absolute bottom-6 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full border-2 border-[#5ee08a]/70 demo-ring" />}
                    {topBird.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/species-image/${topBird.image.id}.webp`} alt={name(topBird, lang)} className="relative max-h-full max-w-full object-contain drop-shadow-[0_24px_30px_rgba(0,0,0,0.55)]" />
                    ) : (
                      <div className="h-44 w-44 rounded-full bg-white/10 flex items-center justify-center text-6xl font-semibold">{name(topBird, lang).slice(0, 1)}</div>
                    )}
                  </div>
                  <div className="pb-4">
                    <h1 className="text-4xl sm:text-6xl font-semibold leading-[1.02] tracking-tight">{name(topBird, lang)}</h1>
                    {topBird.scientific && <div className="mt-2 text-lg italic text-[#9fb5a3]">{topBird.scientific}</div>}
                    <div className="mt-6 flex items-center gap-3 text-sm">
                      <span className={`rounded-full px-3 py-1 font-medium ${stale ? "bg-white/10 text-[#c9d6cb]" : "bg-[#5ee08a]/15 text-[#7ff0a4]"}`}>{ago(top.t, now, lang)}</span>
                      <span className="text-[#c9d6cb]">{pct(top.confidence)} {t.sure}</span>
                      {top.test && <span className="rounded-full border border-amber-300/50 text-amber-200 px-2 py-0.5 text-xs">{t.test}</span>}
                    </div>
                    <div className="mt-3 h-1.5 w-56 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-[#5ee08a]" style={{ width: pct(top.confidence) }} /></div>
                    {top.clip ? (
                      <button type="button" onClick={() => play(top.clip!)} className={`mt-6 inline-flex items-center gap-3 rounded-full px-5 py-2.5 text-base font-semibold transition-colors ${playing === top.clip ? "bg-white/15 text-[#eef3ea]" : "bg-[#5ee08a] text-[#0b1510] hover:bg-[#7ff0a4]"}`}>
                        <PlayIcon on={playing === top.clip} /> {playing === top.clip ? t.playing : t.play}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-center text-[#9fb5a3] text-lg max-w-md mx-auto">{t.waiting}</div>
              )}
            </div>

            {others.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-[#9fb5a3]">{t.before}</div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {others.map((h) => (
                    <figure key={h.key} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 pt-4 pb-3 text-center">
                      <div className="h-24 flex items-end justify-center">
                        {h.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/species-image/${h.image.id}.webp`} alt={name(h, lang)} className="max-h-24 w-auto object-contain drop-shadow-[0_10px_12px_rgba(0,0,0,0.5)]" />
                        ) : <div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center text-2xl">{name(h, lang).slice(0, 1)}</div>}
                      </div>
                      <figcaption className="mt-2 text-sm font-medium leading-tight">{name(h, lang)}</figcaption>
                      <div className="text-[11px] text-[#9fb5a3] mt-0.5">{ago(h.t, now, lang)}</div>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <Stat big={s?.sound.today ?? 0} label={t.today} />
              <Stat big={s?.sound.detectionsToday ?? 0} label={t.detections} />
              <Stat big={s?.sound.week ?? 0} label={t.week} />
            </div>
          </section>

          <aside className="flex flex-col gap-6 min-w-0">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] overflow-hidden">
              <div className="px-5 pt-4 pb-3 flex items-baseline justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.25em] text-[#9fb5a3]">{t.where}</div>
                {d.pos && <div className="text-xs text-[#9fb5a3]">± {d.pos.accM >= 1000 ? `${(d.pos.accM / 1000).toFixed(1)} km` : `${d.pos.accM} m`}</div>}
              </div>
              <DemoMap pos={d.pos} home={d.home} />
              <div className="px-5 py-3 text-xs text-[#9fb5a3] leading-snug">
                {d.pos ? <>{t.fromMast}{d.pos.operator ? ` (${d.pos.operator})` : ""} · {d.pos.source}</> : d.demo.on ? (s?.link.operator ? t.unknownMast : t.mastWait) : t.hidden}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Tile label={t.battery} value={s?.power.v != null ? `${s.power.v.toFixed(2)} V` : "–"} />
              <Tile label={t.power} value={s?.power.piW != null ? `${s.power.piW.toFixed(1)} W` : "–"} />
              <Tile label={t.cpu} value={s?.heat.cpuC != null ? `${Math.round(s.heat.cpuC)} °C` : "–"} />
              <Tile label={t.box} value={s?.heat.boardC != null ? `${s.heat.boardC.toFixed(1)} °C` : "–"} />
              <Tile label={t.signal} value={s?.link.bars != null ? <Bars n={s.link.bars} /> : "–"} sub={s?.link.operator ?? undefined} />
              <Tile label={t.link} value={s?.via ? t[s.via] : "–"} sub={s?.upSince ? `${t.up} ${span(now - s.upSince, lang)}` : undefined} />
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 flex-1 min-h-[220px]">
              <div className="text-[11px] uppercase tracking-[0.25em] text-[#9fb5a3]">{t.feed}</div>
              <ul className="mt-3 space-y-1.5">
                {d.feed.slice(0, 10).map((f) => {
                  const b = d.birds[f.key];
                  return (
                    <li key={f.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${fresh === f.id ? "bg-[#5ee08a]/15 demo-in" : ""}`}>
                      <span className="font-mono text-xs tabular-nums text-[#9fb5a3] w-[64px] shrink-0">{clock(f.t, d.zone)}</span>
                      <span className="h-7 w-7 shrink-0 flex items-center justify-center">
                        {b?.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/species-image/${b.image.id}.webp`} alt="" className="max-h-7 max-w-7 object-contain" />
                        ) : <span className="h-5 w-5 rounded-full bg-white/10" />}
                      </span>
                      <span className="flex-1 truncate text-sm">{name(b, lang)}{f.test ? <span className="ml-2 text-[10px] text-amber-200">{t.test}</span> : null}</span>
                      {f.clip ? (
                        <button type="button" aria-label={t.play} onClick={() => play(f.clip!)} className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center ${playing === f.clip ? "bg-[#5ee08a] text-[#0b1510]" : "bg-white/10 hover:bg-white/20"}`}>
                          <PlayIcon on={playing === f.clip} small />
                        </button>
                      ) : <span className="h-7 w-7 shrink-0" />}
                      <span className="w-16 h-1 rounded-full bg-white/10 overflow-hidden shrink-0"><span className="block h-full bg-[#5ee08a]" style={{ width: pct(f.confidence) }} /></span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </main>
        <footer className="mt-6 text-[11px] text-[#6f8573] flex flex-wrap justify-between gap-2">
          <span>life.oncra.org · {t.by}</span>
          <span>BirdNET · Raspberry Pi · {lang === "nl" ? "zonne-energie en 4G" : "solar power and 4G"}</span>
        </footer>
      </div>
    </div>
  );
}

/** One line that says plainly whether the node is connected: live and over what, how fresh the last word is, since when it
 * is on; otherwise when it last reported and when the next report is due. */
function ConnStrip({ s, now, lang, isLive, hhmm }: { s: DemoOut["status"]; now: number; lang: Lang; isLive: boolean; hhmm: (ms: number) => string }) {
  const t = T[lang];
  if (!s || s.at == null) {
    return <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-[#c9d6cb]">{t.noNews}</div>;
  }
  const via = s.via ? t[s.via] : null;
  const bits: string[] = [];
  if (isLive) {
    bits.push(`${t.lastUpdate} ${ago(s.at, now, lang)}`);
    if (s.via === "wifi" && s.link.wifiDbm != null) bits.push(`${t.wifiSignal} ${s.link.wifiDbm} dBm`);
    if (s.upSince != null) bits.push(`${t.onSince} ${hhmm(s.upSince)}`);
  } else {
    bits.push(`${t.lastReport} ${ago(s.postAt ?? s.at, now, lang)}${via ? ` ${t.via} ${via}` : ""}`);
    if (s.next && s.next.at > now) bits.push(`${t.nextReport} ${hhmm(s.next.at)}`);
  }
  return (
    <div className={`mt-5 rounded-2xl border px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 ${isLive ? "border-[#5ee08a]/35 bg-[#5ee08a]/[0.08]" : "border-amber-300/30 bg-amber-300/[0.06]"}`}>
      <span className="flex items-center gap-2.5">
        <span className={`inline-block h-3 w-3 rounded-full ${isLive ? "bg-[#5ee08a] live-glow" : "bg-amber-300/80"}`} />
        <span className="text-lg font-semibold">{isLive ? `${t.liveVia} ${via ?? "?"}` : `${t.notLive} · ${t[s.state]}`}</span>
      </span>
      <span className="text-sm text-[#c9d6cb]">{bits.join(" · ")}</span>
      {!isLive && <span className="basis-full text-xs text-[#9fb5a3]">{t.offline}</span>}
    </div>
  );
}

function PlayIcon({ on, small }: { on: boolean; small?: boolean }) {
  const s = small ? 12 : 18;
  return on ? (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
  ) : (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden><path d="M4 2.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L5.2 1.5A.8.8 0 0 0 4 2.2z" fill="currentColor" /></svg>
  );
}

function Stat({ big, label }: { big: number; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <div className="text-3xl sm:text-4xl font-semibold tabular-nums">{big}</div>
      <div className="text-xs text-[#9fb5a3] mt-0.5">{label}</div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 min-w-0">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[#9fb5a3]">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-[#9fb5a3] truncate">{sub}</div>}
    </div>
  );
}

function Bars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-end gap-[3px] h-5 align-middle">
      {[1, 2, 3, 4].map((b) => <span key={b} className={`w-[5px] rounded-sm ${b <= n ? "bg-[#5ee08a]" : "bg-white/15"}`} style={{ height: `${b * 25}%` }} />)}
    </span>
  );
}

/** The map: where the node is now (a circle as large as the mast's accuracy), else the area of its place as the public
 * sees it. OpenStreetMap darkened to sit in the board. */
function DemoMap({ pos, home }: { pos: DemoOut["pos"]; home: DemoOut["home"] }) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LType.Map | null>(null);
  const layer = useRef<LType.LayerGroup | null>(null);
  const Lref = useRef<typeof LType | null>(null);
  const shown = useRef<string>("");

  useEffect(() => {
    let gone = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (gone || !el.current || map.current) return;
      Lref.current = L;
      const m = L.map(el.current, { center: [home.lat, home.lon], zoom: 11, zoomControl: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap", className: "demo-tiles" }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      draw();
    })();
    return () => { gone = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const L = Lref.current, m = map.current, g = layer.current;
    if (!L || !m || !g) return;
    const key = pos ? `p:${pos.lat.toFixed(4)},${pos.lon.toFixed(4)},${pos.accM}` : `h:${home.lat},${home.lon},${home.radiusM}`;
    if (key === shown.current) return;
    shown.current = key;
    g.clearLayers();
    if (pos) {
      const c = L.circle([pos.lat, pos.lon], { radius: Math.max(pos.accM, 150), color: "#5ee08a", weight: 1.5, fillColor: "#5ee08a", fillOpacity: 0.12 }).addTo(g);
      L.marker([pos.lat, pos.lon], { icon: L.divIcon({ className: "", html: '<span class="demo-pin"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(g);
      m.flyToBounds(c.getBounds(), { padding: [30, 30], maxZoom: 15, duration: 1.2 });
    } else {
      const c = L.circle([home.lat, home.lon], { radius: home.radiusM ?? 1500, color: "#9fb5a3", weight: 1, dashArray: "4 4", fillOpacity: 0.06 }).addTo(g);
      m.fitBounds(c.getBounds(), { padding: [20, 20] });
    }
  }
  useEffect(draw);

  return <div ref={el} className="h-[300px] w-full bg-[#0f1c15]" />;
}
