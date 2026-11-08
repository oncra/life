"use client";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { rowOf, spectrogram } from "@/lib/spectrogram";

export type TriageClip = {
  id: string;
  ts: string;
  confidence: number;
  /** which model named it: "birdnet-go:birdnet", "birdnet-go:battybirdnet" (the bat model), ... */
  detector: string | null;
  source: string | null;
  fromS: number | null;
  toS: number | null;
  /** how many times slower the sound plays than it was heard (a bat clip: 10); null for real time */
  expansion: number | null;
  hasSound: boolean;
  /** whether the person looking may judge it: signed in and allowed to see its place exactly */
  canJudge: boolean;
  mine: { verdict: string; actual: string | null; note: string | null } | null;
  others: { right: number; wrong: number; unsure: number };
};
export type TriageSpecies = {
  scientific: string;
  name: string | null;
  /** the Dutch name (Wikidata), for the people who judge the clips in the Netherlands */
  nl: string | null;
  /** the cut-out the worker made from the species' Wikipedia photo, with its Commons credits */
  image: { id: string; width: number | null; height: number | null; author: string | null; license: string | null; sourceUrl: string | null } | null;
  reported: number;
  /** how many clips the species has; they are fetched from /api/triage/clips when its row is opened */
  clipCount: number;
  /** the verdicts of the person looking on this species' clips, counted */
  mine: Tally;
};
type Tally = { right: number; wrong: number; unsure: number };
/** clips shown at once in an opened row; more on request */
const STEP = 20;

const VERDICTS = [
  { v: "right", label: "Right", on: "bg-green-600 text-white border-green-600" },
  { v: "wrong", label: "Wrong", on: "bg-red-600 text-white border-red-600" },
  { v: "unsure", label: "Not sure", on: "bg-amber-500 text-white border-amber-500" },
] as const;

const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const mic = (s: string | null) => (s === "Sound Card 1" ? "I2S microphone" : s ?? "microphone unknown");
const MODEL: Record<string, string> = { "birdnet-go:birdnet": "BirdNET", "birdnet-go:battybirdnet": "bat model", "birdnet-go:perch_v2": "Perch" };
const model = (d: string | null) => (d ? MODEL[d] ?? d.replace(/^birdnet-go:/, "") : "detector");

export function Triage({ species, judging, min }: { species: TriageSpecies[]; judging: boolean; /** lowest score shown, percent */ min: number }) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tallies, setTallies] = useState<Record<string, Tally>>(() => Object.fromEntries(species.map((s) => [s.scientific, s.mine])));
  const total = species.reduce((n, s) => n + s.clipCount, 0);
  const sum = (t: Tally) => t.right + t.wrong + t.unsure;
  const judged = Object.values(tallies).reduce((n, t) => n + sum(t), 0);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return species.filter((s) => !t || [s.scientific, s.name, s.nl].some((n) => (n ?? "").toLowerCase().includes(t)));
  }, [species, q]);
  const moved = (sci: string, from: string | null, to: string | null) =>
    setTallies((all) => {
      const t = { ...all[sci] };
      if (from && from in t) t[from as keyof Tally]--;
      if (to && to in t) t[to as keyof Tally]++;
      return { ...all, [sci]: t };
    });
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {judging ? (
          <>
            <span className="font-medium">{judged} of {total} clips judged by you</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> only clips not yet judged</label>
          </>
        ) : <span className="font-medium">{total} clips of {species.length} species</span>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a species" className="rounded border border-line px-2 py-1 text-sm" />
      </div>
      <div className="mt-4 grid gap-4">
        {shown.map((s) =>
          onlyOpen && s.clipCount - sum(tallies[s.scientific]) <= 0 ? null : (
            <SpeciesRow key={s.scientific} s={s} tally={tallies[s.scientific]} judging={judging} onlyOpen={onlyOpen} min={min} startOpen={species.length <= 3}
              onMoved={(from, to) => moved(s.scientific, from, to)} />
          ),
        )}
      </div>
    </div>
  );
}

// A species and, once opened, its clips: fetched on the first opening and shown STEP at a time, so a page with
// thousands of clips stays light and only the rows someone opens cost anything.
function SpeciesRow({ s, tally, judging, onlyOpen, min, startOpen, onMoved }: {
  s: TriageSpecies; tally: Tally; judging: boolean; onlyOpen: boolean; min: number; startOpen: boolean; onMoved: (from: string | null, to: string | null) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [clips, setClips] = useState<TriageClip[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(STEP);
  const [done, setDone] = useState<Record<string, string | null>>({});
  const asked = useRef(false);
  useEffect(() => {
    if (!open || asked.current || failed) return;
    asked.current = true;
    fetch(`/api/triage/clips?species=${encodeURIComponent(s.scientific)}&min=${min}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { clips: TriageClip[] }) => {
        setClips(d.clips);
        setDone(Object.fromEntries(d.clips.map((c) => [c.id, c.mine?.verdict ?? null])));
      })
      .catch(() => {
        asked.current = false;
        setFailed(true);
      });
  }, [open, s.scientific, failed, min]);
  const list = clips ? (onlyOpen ? clips.filter((c) => !done[c.id]) : clips) : [];
  return (
    <details className="rounded-lg border border-line bg-white" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer p-4">
        <span className="inline-flex items-center gap-3 align-middle">
          <span className="flex h-16 w-20 shrink-0 items-center justify-center">
            {s.image ? (
              <Image src={`/api/species-image/${s.image.id}.webp`} alt="" width={s.image.width || 160} height={s.image.height || 120} unoptimized loading="lazy"
                className="max-h-16 w-auto max-w-full object-contain" />
            ) : null}
          </span>
          <span>
            <span className="font-semibold">{s.nl ?? s.name ?? s.scientific}</span>
            {s.nl && s.name && s.name !== s.nl ? <span className="text-muted"> · {s.name}</span> : null}
            {s.nl || s.name ? <span className="italic text-muted"> · {s.scientific}</span> : null}
            <span className="block text-sm text-muted mt-1">
              reported {s.reported} times · {s.clipCount} clips{judging ? <> · right {tally.right}, wrong {tally.wrong}, not sure {tally.unsure}</> : null}
            </span>
          </span>
        </span>
      </summary>
      {s.image && (s.image.author || s.image.license) ? (
        <div className="-mt-2 px-4 pb-2 text-xs text-muted">
          Photo: {s.image.sourceUrl ? <a href={s.image.sourceUrl} className="underline" target="_blank" rel="noreferrer">{s.image.author ?? "Wikimedia Commons"}</a> : s.image.author}
          {s.image.license ? `, ${s.image.license}` : ""}, background removed
        </div>
      ) : null}
      {open ? (
        clips === null ? (
          <div className="px-4 pb-4 text-sm text-muted">
            {failed ? <>The clips did not load. <button type="button" className="underline" onClick={() => setFailed(false)}>Try again</button></> : "Loading the clips…"}
          </div>
        ) : (
          <>
            <ul className="grid gap-3 px-4 pb-4">
              {list.slice(0, limit).map((c) => (
                <ClipRow key={c.id} clip={c} onSaved={(v) => {
                  onMoved(done[c.id] ?? null, v);
                  setDone((d) => ({ ...d, [c.id]: v }));
                }} />
              ))}
            </ul>
            {list.length > limit ? (
              <div className="px-4 pb-4">
                <button type="button" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:border-accent" onClick={() => setLimit((n) => n + STEP)}>
                  Show {Math.min(STEP, list.length - limit)} more ({list.length - limit} left)
                </button>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </details>
  );
}

function ClipRow({ clip, onSaved }: { clip: TriageClip; onSaved: (v: string | null) => void }) {
  const [verdict, setVerdict] = useState<string | null>(clip.mine?.verdict ?? null);
  const [actual, setActual] = useState(clip.mine?.actual ?? "");
  const [note, setNote] = useState(clip.mine?.note ?? "");
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const [spec, setSpec] = useState(false);
  async function save(v: string | null, a = actual, n = note) {
    setState("saving");
    const r = await fetch(`/api/clips/${clip.id}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verdict: v, actual: a, note: n }) }).catch(() => null);
    if (r?.ok) {
      setVerdict(v);
      onSaved(v);
      setState("saved");
    } else setState("error");
  }
  const o = clip.others;
  const x = clip.expansion ?? 1;
  return (
    <li className="rounded border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="font-semibold" title="How sure the model was that this is the species named: its score for this detection">
            {model(clip.detector)} {Math.round(clip.confidence * 100)}% sure
          </span> · {when.format(new Date(clip.ts))} · {mic(clip.source)}
        </span>
        {o.right + o.wrong + o.unsure > 0 ? <span className="text-muted">others: right {o.right}, wrong {o.wrong}, not sure {o.unsure}</span> : null}
      </div>
      {clip.hasSound ? (
        <>
          <audio controls preload="none" src={`/api/clips/${clip.id}/audio`} className="mt-2 w-full" />
          {x > 1 ? <div className="text-xs text-muted mt-1">Slowed down {x} times, so a bat call at 40 kHz is heard at {40 / x} kHz; the spectrogram shows the frequencies as they were.</div> : null}
          {clip.fromS != null && clip.toS != null ? <div className="text-xs text-muted mt-1">The detected part is {clip.fromS * x} to {clip.toS * x} s into the clip.</div> : null}
          <button type="button" className="mt-1 text-xs underline" onClick={() => setSpec((s) => !s)}>{spec ? "hide spectrogram" : "show spectrogram"}</button>
          {spec ? <Spectrogram src={`/api/clips/${clip.id}/audio`} fromS={clip.fromS} toS={clip.toS} x={x} /> : null}
        </>
      ) : (
        <div className="mt-2 text-sm text-muted">The sound of this clip has been deleted.</div>
      )}
      {clip.canJudge ? (
      <div className="mt-3 flex flex-wrap gap-2">
        {VERDICTS.map((b) => (
          <button key={b.v} type="button" aria-pressed={verdict === b.v} onClick={() => save(verdict === b.v ? null : b.v)}
            className={`rounded border px-3 py-1 text-sm ${verdict === b.v ? b.on : "border-line bg-white"}`}>{b.label}</button>
        ))}
        <span className="self-center text-xs text-muted">{state === "saving" ? "saving" : state === "saved" ? "saved" : state === "error" ? "not saved, try again" : ""}</span>
      </div>
      ) : null}
      {clip.canJudge && (verdict === "wrong" || verdict === "unsure" ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input value={actual} onChange={(e) => setActual(e.target.value)} onBlur={() => save(verdict)} placeholder="What is it then? (a species, a ship horn, a car...)" className="rounded border border-line px-2 py-1 text-sm" />
          <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => save(verdict)} placeholder="Note" className="rounded border border-line px-2 py-1 text-sm" />
        </div>
      ) : null)}
    </li>
  );
}

// A spectrogram drawn in the browser from the clip itself (src/lib/spectrogram.ts), labelled in the frequencies the
// microphone heard; the detected seconds are shaded.
function Spectrogram({ src, fromS, toS, x: slow }: { src: string; fromS: number | null; toS: number | null; x: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState("drawing");
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const buf = await (await fetch(src)).arrayBuffer();
        const audio = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf);
        if (gone) return;
        const x = audio.getChannelData(0);
        const sp = spectrogram(x, audio.sampleRate, slow);
        const { db, frames, rows: H, top } = sp;
        const c = ref.current;
        if (!c) return;
        c.width = frames;
        c.height = H;
        const g = c.getContext("2d");
        if (!g) return;
        const img = g.createImageData(frames, H);
        for (let f = 0; f < frames; f++) {
          for (let y = 0; y < H; y++) {
            const t = Math.max(0, Math.min(1, (db[f * H + y] - (top - 75)) / 75));
            const p = (y * frames + f) * 4;
            const ink = Math.round(255 * (1 - t));
            img.data[p] = ink; img.data[p + 1] = ink; img.data[p + 2] = Math.round(255 * (1 - 0.7 * t)); img.data[p + 3] = 255;
          }
        }
        g.putImageData(img, 0, 0);
        const secs = x.length / audio.sampleRate;
        if (fromS != null && toS != null) {
          g.fillStyle = "rgba(220, 120, 0, 0.18)";
          g.fillRect(((fromS * slow) / secs) * frames, 0, (((toS - fromS) * slow) / secs) * frames, H);
        }
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.font = "11px sans-serif";
        for (const hz of slow > 1 ? [20000, 40000, 80000] : [100, 1000, 4000, 10000]) {
          const y = rowOf(sp, hz, slow);
          if (y === null) continue;
          g.fillRect(0, y, 6, 1);
          g.fillText(hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`, 8, y + 4);
        }
        setMsg("");
      } catch {
        if (!gone) setMsg("This browser could not read the clip to draw it.");
      }
    })();
    return () => {
      gone = true;
    };
  }, [src, fromS, toS, slow]);
  return (
    <div className="mt-2">
      <canvas ref={ref} className="w-full h-40 rounded border border-line" style={{ imageRendering: "pixelated" }} />
      {msg ? <div className="text-xs text-muted">{msg}</div> : null}
    </div>
  );
}
