"use client";
import { useState } from "react";
import type { VisitState } from "@/lib/node-visit";

// The owner's corner of the node dashboard: the WiFi the node uses on a visit, the alarm window, and the clips, on the
// node and on the oracle. Shown only to whoever may run the node (src/lib/privacy.ts canManage); the API checks again.

type Props = { place: string; state: VisitState; months: { month: string; n: number }[]; zone: string };

const APP = "https://github.com/oncra/life/tree/main/clients/clips-app";
const VISIT_HOW: Record<string, string> = {
  online: "the node was online already",
  hotspot: "over a phone's hotspot",
  wifi: "a laptop on the node's WiFi",
  "hotspot+wifi": "a hotspot, then a laptop",
  none: "nothing taken",
};

export default function OwnerPanel({ place, state: initial, months, zone }: Props) {
  const [s, setS] = useState(initial);
  const [ssid, setSsid] = useState(initial.ssid);
  const [psk, setPsk] = useState(initial.psk);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const base = `/api/v1/places/${encodeURIComponent(place)}/devices/${encodeURIComponent(s.device)}`;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

  async function call(label: string, path: string, method: string, body?: unknown, done?: string) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fetch(`${base}/${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ ok: false, text: j.issues?.[0]?.message ?? j.error ?? `the oracle answered ${r.status}` });
        return;
      }
      const fresh = await fetch(`${base}/visit`, { cache: "no-store" });
      if (fresh.ok) {
        const v: VisitState = await fresh.json();
        setS(v);
        setSsid(v.ssid);
        setPsk(v.psk);
      }
      if (done) setMsg({ ok: true, text: done });
    } catch {
      setMsg({ ok: false, text: "No connection to the oracle. Try again." });
    } finally {
      setBusy(null);
    }
  }

  const c = s.clips;
  const input = "mt-1 w-full rounded border border-line px-2 py-1.5 bg-white";
  const button = "rounded-md border border-line bg-white px-3 py-1.5 hover:border-accent disabled:opacity-50";
  return (
    <section className="mt-6 rounded-lg border border-accent/40 bg-white p-4">
      <h2 className="text-lg font-semibold">For the owner</h2>
      <p className="text-sm text-muted max-w-3xl">Only you see this. A visit takes the clips off the node: turn on your phone&apos;s hotspot, hold the magnet on the mark for three seconds, and the node wakes, joins the hotspot and sends its clips to the oracle itself. That takes a few minutes; the clips show up below as they arrive. Without a hotspot, the laptop app fetches them over the node&apos;s own WiFi. After at most 30 minutes the node sleeps again, unless it is in a listening window or the alarm is silenced.</p>
      {msg && <div className={`mt-3 rounded border p-2 text-sm ${msg.ok ? "border-accent bg-green-50" : "border-red-300 bg-red-50"}`}>{msg.text}</div>}

      <div className="mt-4 grid gap-6 md:grid-cols-2 text-sm">
        <form onSubmit={(e) => { e.preventDefault(); call("visit", "visit", "PUT", { ssid, psk }, "Saved. The node gets it with its next heartbeat."); }} className="space-y-2">
          <h3 className="font-medium">Your phone&apos;s hotspot</h3>
          <label className="block">Name<input required maxLength={32} value={ssid} onChange={(e) => setSsid(e.target.value)} className={input} autoComplete="off" /></label>
          <label className="block">Password
            <div className="flex gap-2"><input required minLength={8} maxLength={63} type={show ? "text" : "password"} value={psk} onChange={(e) => setPsk(e.target.value)} className={`${input} font-mono`} autoComplete="off" />
              <button type="button" onClick={() => setShow(!show)} className={`${button} mt-1`}>{show ? "Hide" : "Show"}</button></div>
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy !== null} className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50">{busy === "visit" ? "Saving…" : "Save"}</button>
            {!(s.defaults.ssid && s.defaults.psk) && <button type="button" disabled={busy !== null} onClick={() => call("default", "visit", "PUT", { ssid: null, psk: null }, "Back to hotspot / 12345678.")} className={button}>Use the default</button>}
          </div>
          <p className="text-xs text-muted">The default works at every node: name your hotspot <code>hotspot</code> with password <code>12345678</code>. Or type your phone&apos;s own hotspot name here; capitals, extra spaces and the kind of apostrophe do not matter. On an iPhone the hotspot&apos;s name is the phone&apos;s name (Settings, General, About); turn on Maximise Compatibility, and keep the Personal Hotspot screen open until the node has joined, because an iPhone hides its hotspot otherwise. On Android choose WPA2 or WPA2/WPA3, not WPA3 alone.</p>
          <p className="text-xs">{s.nodeHas ? <span className="text-green-800">The node has these settings.</span> : <span className="text-amber-700">The node gets these with its next heartbeat, within the hour while it is awake. Until then it uses what it had{s.nodeRev === -1 ? " (the default)" : ""}.</span>}</p>
        </form>

        <div className="space-y-2">
          <h3 className="font-medium">The node&apos;s own WiFi, for a laptop</h3>
          <div>Name <code className="ml-1">{s.apSsid}</code></div>
          <div>Password <code className="ml-1">{s.apPsk}</code></div>
          <button type="button" disabled={busy !== null} onClick={() => call("ap", "visit", "PUT", { apPsk: null }, "A new password. The node gets it with its next heartbeat.")} className={button}>Draw a new password</button>
          <p className="text-xs text-muted">For many clips or no phone signal: the <a href={APP} className="underline">Life Clips app</a> for macOS and Windows joins this WiFi, downloads the clips and sends them to the oracle once the laptop is online again. The node deletes them when the oracle has them all.</p>
        </div>

        <div className="space-y-2">
          <h3 className="font-medium">Alarm</h3>
          {s.maintenance ? (
            <p><span className="font-medium text-amber-700">Silenced</span> until {when(s.maintenance.until)}. You can open the lid.</p>
          ) : <p><span className="font-medium text-green-800">Armed.</span> Opening the lid or panel sets it off.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => call("m4", "maintenance", "PUT", { hours: 4 }, "Silenced for 4 hours.")} className={button}>Silence for 4 hours</button>
            <button type="button" disabled={busy !== null} onClick={() => call("m24", "maintenance", "PUT", { hours: 24 }, "Silenced for 24 hours.")} className={button}>For 24 hours</button>
            {s.maintenance && <button type="button" disabled={busy !== null} onClick={() => call("arm", "maintenance", "DELETE", undefined, "Armed again.")} className={button}>Arm now</button>}
          </div>
          <p className="text-xs text-muted">A visit with the magnet needs no silence: the lid stays shut. The magnet wakes the node and never silences the alarm, so a magnet alone cannot open the box unheard. A window set before you go means no chirp at all; set on the spot, the node hears it on the alarm boot. While the alarm is silenced, a visit leaves the node on afterwards, for work at the box.</p>
        </div>

        <div className="space-y-2">
          <h3 className="font-medium">Clips</h3>
          {c ? (
            <ul className="space-y-0.5">
              <li>On the node: <span className="font-medium">{c.waiting} waiting</span> ({c.mb.toFixed(0)} MB){c.full ? <span className="text-amber-700"> · nearly full: only the sample still grows until a visit</span> : null}</li>
              {c.handed > 0 && <li>{c.handed} on a laptop, deleted from the node when the oracle has them</li>}
              <li>Last sent: {when(c.sentAt)} · last on a stick: {when(c.collectedAt)}</li>
              {s.last && <li>Last visit: {when(s.last.at)}, {VISIT_HOW[s.last.how] ?? s.last.how}{s.last.sent > 0 ? `, ${s.last.sent} sent` : ""}{s.last.handed > 0 ? `, ${s.last.handed} to a laptop` : ""}{s.last.minutes !== null ? ` (${Math.round(s.last.minutes)} min)` : ""}</li>}
              <li className="text-muted">As the node said at {when(s.heardAt)}.</li>
            </ul>
          ) : <p className="text-muted">The node has not reported clips yet.</p>}
          {months.length > 0 ? (
            <div>On the oracle, to download:
              <ul className="mt-1 flex flex-wrap gap-2">{months.map((m) => <li key={m.month}><a className={`${button} inline-block`} href={`/api/v1/places/${encodeURIComponent(place)}/clips.zip?month=${m.month}`}>{m.month} · {m.n}</a></li>)}</ul>
            </div>
          ) : <p className="text-muted">No clips on the oracle yet.</p>}
        </div>
      </div>
    </section>
  );
}
