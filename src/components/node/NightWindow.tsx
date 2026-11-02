"use client";
import { useState } from "react";
import type { NightState } from "@/lib/node-night";
import { nightLastText, spanText } from "@/lib/night";
import { dayLabel } from "@/lib/clock";

// The owner's meadow-bird window, a block of the owner's panel (OwnerPanel): turn it on, set when it runs, see whether
// the node has it and how the last one went. The API checks who may change it (src/lib/privacy.ts canManage).

type Props = { place: string; state: NightState; zone: string };

export default function NightWindow({ place, state: initial, zone }: Props) {
  const [s, setS] = useState(initial);
  const [f, setF] = useState(initial.settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const url = `/api/v1/places/${encodeURIComponent(place)}/devices/${encodeURIComponent(s.device)}/night`;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === "" ? NaN : Number(v));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ ok: false, text: j.issues?.[0]?.message ?? j.error ?? `the oracle answered ${r.status}` });
        return;
      }
      setS(j);
      setF(j.settings);
      setMsg({ ok: true, text: "Saved. The node gets it with its next heartbeat." });
    } catch {
      setMsg({ ok: false, text: "No connection to the oracle. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded border border-line px-2 py-1.5 bg-white";
  const day = (d: string) => dayLabel(Date.parse(`${d}T12:00:00Z`), zone);
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-2 md:col-span-2">
      <h3 className="font-medium">Meadow-bird window</h3>
      <p className="text-xs text-muted max-w-3xl">Off by default. For meadow-bird research: black-tailed godwit, lapwing and snipe (grutto, kievit, watersnip) call most in the first hours of darkness, after the node&apos;s dusk window has ended, so the node can listen on for them. The readings never count this window, so the place is read on the same hours as every other. It costs about 6 Wh an hour from the battery: the node draws about 3.1 W awake and 2.5 W more while its bat model runs after sunset (the kit&apos;s bench log). With the battery option a dull spell skips the night, never the dawn.</p>
      {msg && <div className={`rounded border p-2 ${msg.ok ? "border-accent bg-green-50" : "border-red-300 bg-red-50"}`}>{msg.text}</div>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.on} onChange={(e) => set("on", e.target.checked)} />Listen for meadow birds after sunset</label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">Start, minutes after sunset<input type="number" required min={0} max={360} step={5} value={Number.isNaN(f.startMin) ? "" : f.startMin} onChange={(e) => set("startMin", num(e.target.value))} className={input} /></label>
        <label className="block">Length, minutes<input type="number" required min={15} max={180} step={5} value={Number.isNaN(f.lenMin) ? "" : f.lenMin} onChange={(e) => set("lenMin", num(e.target.value))} className={input} /></label>
        <label className="block">From (MM-DD)<input required pattern="\d{2}-\d{2}" placeholder="03-25" value={f.from} onChange={(e) => set("from", e.target.value.trim())} className={`${input} font-mono`} /></label>
        <label className="block">To (MM-DD)<input required pattern="\d{2}-\d{2}" placeholder="06-30" value={f.to} onChange={(e) => set("to", e.target.value.trim())} className={`${input} font-mono`} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.battery} onChange={(e) => set("battery", e.target.checked)} />Only when the battery allows: at least</label>
        <input type="number" aria-label="Minimum battery volts" required min={12} max={14} step={0.1} disabled={!f.battery} value={Number.isNaN(f.minV) ? "" : f.minV} onChange={(e) => set("minV", num(e.target.value))} className="w-24 rounded border border-line px-2 py-1.5 bg-white disabled:opacity-50" />
        <span>V at its start</span>
      </div>
      <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      <ul className="text-xs space-y-0.5">
        <li>{!s.settings.on ? <span className="text-muted">Off: the node listens only in its listening windows.</span>
          : s.tonight ? <>Next: <span className="font-medium">{dayLabel(Date.parse(s.tonight.start), zone)} {spanText(s.tonight.start, s.tonight.end, zone)}</span>{s.settings.battery ? ` if the battery holds ${s.settings.minV.toFixed(1)} V` : ""}</>
          : !s.fits ? <span className="text-amber-700">These times leave no room between the dusk window and the next dawn: start earlier or make it shorter.</span>
          : <>Out of season{s.seasonFrom ? ` until ${day(s.seasonFrom)}` : ""}.</>}</li>
        {s.last && <li>Last window, {nightLastText(s.last, zone)}.</li>}
        <li>{s.nodeHas ? <span className="text-green-800">The node has these settings.</span>
          : s.nodeRev === null ? <span className="text-amber-700">The node has not said yet that it knows this window; it takes the settings once its programs are updated.</span>
          : <span className="text-amber-700">The node gets these with its next heartbeat, while it is awake. Until then it keeps what it had.</span>}</li>
      </ul>
    </form>
  );
}
