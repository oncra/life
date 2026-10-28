"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type TriageClip = {
  id: string;
  ts: string;
  confidence: number;
  source: string | null;
  fromS: number | null;
  toS: number | null;
  hasSound: boolean;
  mine: { verdict: string; actual: string | null; note: string | null } | null;
  others: { right: number; wrong: number; unsure: number };
};
export type TriageSpecies = { scientific: string; name: string | null; reported: number; clips: TriageClip[] };

const VERDICTS = [
  { v: "right", label: "Right", on: "bg-green-600 text-white border-green-600" },
  { v: "wrong", label: "Wrong", on: "bg-red-600 text-white border-red-600" },
  { v: "unsure", label: "Not sure", on: "bg-amber-500 text-white border-amber-500" },
] as const;

const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const mic = (s: string | null) => (s === "Sound Card 1" ? "I2S microphone" : s ?? "microphone unknown");

export function Triage({ species }: { species: TriageSpecies[] }) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [q, setQ] = useState("");
  const [done, setDone] = useState<Record<string, string | null>>(() => Object.fromEntries(species.flatMap((s) => s.clips.map((c) => [c.id, c.mine?.verdict ?? null]))));
  const total = species.reduce((n, s) => n + s.clips.length, 0);
  const judged = Object.values(done).filter(Boolean).length;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return species.filter((s) => !t || s.scientific.toLowerCase().includes(t) || (s.name ?? "").toLowerCase().includes(t));
  }, [species, q]);
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{judged} of {total} clips judged by you</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> only clips not yet judged</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a species" className="rounded border border-line px-2 py-1 text-sm" />
      </div>
      <div className="mt-4 grid gap-4">
        {shown.map((s) => {
          const clips = onlyOpen ? s.clips.filter((c) => !done[c.id]) : s.clips;
          if (clips.length === 0) return null;
          const tally = s.clips.reduce((t, c) => { const v = done[c.id]; if (v) t[v] = (t[v] ?? 0) + 1; return t; }, {} as Record<string, number>);
          return (
            <details key={s.scientific} className="rounded-lg border border-line bg-white" open={species.length <= 3}>
              <summary className="cursor-pointer p-4">
                <span className="font-semibold">{s.name ?? s.scientific}</span>{s.name ? <span className="italic text-muted"> {s.scientific}</span> : null}
                <span className="block text-sm text-muted mt-1">
                  reported {s.reported} times · {s.clips.length} clips · right {tally.right ?? 0}, wrong {tally.wrong ?? 0}, not sure {tally.unsure ?? 0}
                </span>
              </summary>
              <ul className="grid gap-3 px-4 pb-4">
                {clips.map((c) => <ClipRow key={c.id} clip={c} onSaved={(v) => setDone((d) => ({ ...d, [c.id]: v }))} />)}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
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
  return (
    <li className="rounded border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span><span className="font-semibold">{clip.confidence.toFixed(2)}</span> · {when.format(new Date(clip.ts))} · {mic(clip.source)}</span>
        {o.right + o.wrong + o.unsure > 0 ? <span className="text-muted">others: right {o.right}, wrong {o.wrong}, not sure {o.unsure}</span> : null}
      </div>
      {clip.hasSound ? (
        <>
          <audio controls preload="none" src={`/api/clips/${clip.id}/audio`} className="mt-2 w-full" />
          {clip.fromS != null && clip.toS != null ? <div className="text-xs text-muted mt-1">The detected part is {clip.fromS} to {clip.toS} s into the clip.</div> : null}
          <button type="button" className="mt-1 text-xs underline" onClick={() => setSpec((x) => !x)}>{spec ? "hide spectrogram" : "show spectrogram"}</button>
          {spec ? <Spectrogram src={`/api/clips/${clip.id}/audio`} fromS={clip.fromS} toS={clip.toS} /> : null}
        </>
      ) : (
        <div className="mt-2 text-sm text-muted">The sound of this clip has been deleted.</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {VERDICTS.map((b) => (
          <button key={b.v} type="button" aria-pressed={verdict === b.v} onClick={() => save(verdict === b.v ? null : b.v)}
            className={`rounded border px-3 py-1 text-sm ${verdict === b.v ? b.on : "border-line bg-white"}`}>{b.label}</button>
        ))}
        <span className="self-center text-xs text-muted">{state === "saving" ? "saving" : state === "saved" ? "saved" : state === "error" ? "not saved, try again" : ""}</span>
      </div>
      {verdict === "wrong" || verdict === "unsure" ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input value={actual} onChange={(e) => setActual(e.target.value)} onBlur={() => save(verdict)} placeholder="What is it then? (a species, a ship horn, a car...)" className="rounded border border-line px-2 py-1 text-sm" />
          <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => save(verdict)} placeholder="Note" className="rounded border border-line px-2 py-1 text-sm" />
        </div>
      ) : null}
    </li>
  );
}

// A spectrogram drawn in the browser from the clip itself: 50 Hz to 16 kHz on a log scale, so a ship horn's low hum
// and a bird's song are both readable; the detected seconds are shaded.
function Spectrogram({ src, fromS, toS }: { src: string; fromS: number | null; toS: number | null }) {
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
        const rate = audio.sampleRate;
        const N = 2048;
        const W = 900;
        const H = 240;
        const hop = Math.max(128, Math.floor(x.length / W));
        const frames = Math.max(1, Math.floor((x.length - N) / hop));
        const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
        const fmin = 50, fmax = Math.min(16000, rate / 2);
        const rowBin = Array.from({ length: H }, (_, y) => Math.round((fmin * Math.pow(fmax / fmin, (H - 1 - y) / (H - 1)) * N) / rate));
        const db = new Float32Array(frames * H);
        const re = new Float32Array(N);
        const im = new Float32Array(N);
        let top = -Infinity;
        for (let f = 0; f < frames; f++) {
          for (let i = 0; i < N; i++) { re[i] = x[f * hop + i] * win[i]; im[i] = 0; }
          fft(re, im);
          for (let y = 0; y < H; y++) {
            const k = rowBin[y];
            const v = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
            db[f * H + y] = v;
            if (v > top) top = v;
          }
        }
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
        const secs = x.length / rate;
        if (fromS != null && toS != null) {
          g.fillStyle = "rgba(220, 120, 0, 0.18)";
          g.fillRect((fromS / secs) * frames, 0, ((toS - fromS) / secs) * frames, H);
        }
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.font = "11px sans-serif";
        for (const hz of [100, 1000, 4000, 10000]) {
          if (hz > fmax) continue;
          const y = H - 1 - ((H - 1) * Math.log(hz / fmin)) / Math.log(fmax / fmin);
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
  }, [src, fromS, toS]);
  return (
    <div className="mt-2">
      <canvas ref={ref} className="w-full h-40 rounded border border-line" style={{ imageRendering: "pixelated" }} />
      {msg ? <div className="text-xs text-muted">{msg}</div> : null}
    </div>
  );
}

/** In-place radix-2 FFT; re and im have a power-of-two length. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2;
        const br = re[v] * cr - im[v] * ci;
        const bi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - br; im[v] = im[u] - bi;
        re[u] += br; im[u] += bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
