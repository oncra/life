"use client";
import { useEffect, useState } from "react";
import type { VisitState } from "@/lib/node-visit";
import type { NightState } from "@/lib/node-night";
import type { ConfigState } from "@/lib/node-config";
import NightWindow from "./NightWindow";
import NodeSettings from "./NodeSettings";

// The owner's corner of the node dashboard. It opens with the visit, the way the clips leave a node in a field: the
// phone's hotspot (set once), what to do at the box, and the visit as it happens, from the node's posts and the clips
// arriving; the laptop app is the way without phone signal. Then the alarm window, the clips, on the node and on the
// oracle, the meadow-bird window (NightWindow) and the settings over 4G (NodeSettings). Shown only to whoever may run
// the node (src/lib/privacy.ts canManage); the API checks again.

type Props = { place: string; state: VisitState; night?: NightState; config?: ConfigState; months: { month: string; n: number }[]; zone: string };

/** The newest Life Clips app for each kind of laptop (src/app/download/life-clips/[os]/route.ts). */
const APP = "/download/life-clips";
const VISIT_HOW: Record<string, string> = {
  online: "the node was online already",
  hotspot: "over a phone's hotspot",
  wifi: "a laptop on the node's WiFi",
  "hotspot+wifi": "a hotspot, then a laptop",
  none: "nothing taken",
};

type Line = { tone: "wait" | "go" | "ok" | "warn"; text: string };

const clips = (k: number) => `${k} ${k === 1 ? "clip" : "clips"}`;
const AGAIN = "Switch the hotspot on, keep its screen open and hold the magnet on the mark once more: the node looks again.";

/** What a visit going on now looks like to the visitor (VisitState.now, from the node's posts at its turns): where the
 * node is, and the clips that reached the oracle since the visit began. `left` is what the node's newest post said was
 * still on it; posted after the clips went (phase sent), that is what stays. No clock of the browser's own: the oracle
 * says whether the search is still on, so the page renders the same on the server and in the browser. */
function visitLine(s: VisitState, clock: (iso: string) => string): Line | null {
  const n = s.now;
  if (!n) return null;
  const name = n.hotspot ? ` "${n.hotspot}"` : "";
  const left = s.clips?.waiting ?? null;
  if (n.phase === "sent") {
    const off = n.hotspot ? " You can switch your hotspot off." : "";
    if (left === 0) return { tone: "ok", text: n.arrived ? `All ${clips(n.arrived)} arrived.${off}` : `There was nothing to send.${off}` };
    return { tone: "go", text: `${clips(n.arrived)} arrived; ${left === null ? "some are" : `${left} ${left === 1 ? "is" : "are"}`} still on the node.` };
  }
  if (n.phase === "wifi") {
    const wifi = `it has opened its own WiFi for a laptop, until ${clock(n.until)}`;
    if (n.arrived) return { tone: "warn", text: `${clips(n.arrived)} arrived over your hotspot; for the ${left === null ? "clips" : clips(left)} left ${wifi}. ${AGAIN}` };
    if (n.sent !== null) return { tone: "warn", text: `The node joined your hotspot, but no clip went out over it: does your phone have mobile data here? Now ${wifi}.` };
    return { tone: "warn", text: `The node did not find your hotspot${name}, so ${wifi}. Check its name and password in step 1. ${AGAIN}` };
  }
  if (n.arrived) return { tone: "go", text: `${n.hotspot ? "On your hotspot: " : ""}${n.arrived}${left ? ` of ${left}` : ""} clips arrived.` };
  if (n.phase === "online") return { tone: "go", text: "The node is online over its own connection and sends its clips." };
  if (n.phase === "hotspot") return { tone: "go", text: `The node is on your hotspot${name} and starts sending.` };
  if (n.phase === "looking" && n.lookUntil) {
    return n.looking
      ? { tone: "wait", text: `The node is awake and looks for your hotspot${name} until ${clock(n.lookUntil)}. Keep the hotspot screen open until your phone shows a connection.` }
      : { tone: "warn", text: `The node looked for your hotspot${name} until ${clock(n.lookUntil)} and has not said it found it. No clips within a minute? ${AGAIN}` };
  }
  return { tone: "wait", text: "The node is starting the visit." };
}

const TONE: Record<Line["tone"], string> = {
  wait: "border-amber-300 bg-amber-50",
  go: "border-accent bg-green-50",
  ok: "border-accent bg-green-50 font-medium",
  warn: "border-red-300 bg-red-50",
};

export default function OwnerPanel({ place, state: initial, night, config, months, zone }: Props) {
  const [s, setS] = useState(initial);
  const [ssid, setSsid] = useState(initial.ssid);
  const [psk, setPsk] = useState(initial.psk);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const base = `/api/v1/places/${encodeURIComponent(place)}/devices/${encodeURIComponent(s.device)}`;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
  const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  const live = s.now !== null;

  // While the panel is open the visit shows as it happens: every 5 s during one, every 20 s otherwise, so that its start
  // shows within moments of the node's first post, and at once when the phone comes back from its hotspot screen. A
  // hidden tab asks nothing; the form keeps what is being typed.
  useEffect(() => {
    let gone = false;
    async function look() {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`${base}/visit`, { cache: "no-store" });
        if (r.ok && !gone) setS(await r.json());
      } catch {
        // no connection for a moment: the next tick asks again
      }
    }
    const id = setInterval(look, live ? 5_000 : 20_000);
    document.addEventListener("visibilitychange", look);
    return () => {
      gone = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", look);
    };
  }, [base, live]);

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
  const line = visitLine(s, clock);
  const input = "mt-1 w-full rounded border border-line px-2 py-1.5 bg-white";
  const button = "rounded-md border border-line bg-white px-3 py-1.5 hover:border-accent disabled:opacity-50";
  const step = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white";
  return (
    <section className="mt-6 rounded-lg border border-accent/40 bg-white p-4">
      <h2 className="text-lg font-semibold">For the owner</h2>
      <p className="text-sm text-muted max-w-3xl">Only you see this.</p>
      {msg && <div className={`mt-3 rounded border p-2 text-sm ${msg.ok ? "border-accent bg-green-50" : "border-red-300 bg-red-50"}`}>{msg.text}</div>}

      <div className="mt-4 max-w-3xl text-sm">
        <h3 className="text-base font-semibold">Take the clips off the node</h3>
        <p className="text-muted">Your phone&apos;s hotspot does it: the node joins it and sends its clips to the oracle itself. No app, and the box stays shut.</p>
        <ol className="mt-3 space-y-5">
          <li className="flex gap-3">
            <span className={step}>1</span>
            <form onSubmit={(e) => { e.preventDefault(); call("visit", "visit", "PUT", { ssid, psk }, "Saved. The node takes it when the visit starts."); }} className="min-w-0 flex-1 space-y-2">
              <div className="font-medium">Your phone&apos;s hotspot, once</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">Name<input required maxLength={32} value={ssid} onChange={(e) => setSsid(e.target.value)} className={input} autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>
                <label className="block">Password
                  <div className="flex gap-2"><input required minLength={8} maxLength={63} type={show ? "text" : "password"} value={psk} onChange={(e) => setPsk(e.target.value)} className={`${input} font-mono`} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                    <button type="button" onClick={() => setShow(!show)} className={`${button} mt-1`}>{show ? "Hide" : "Show"}</button></div>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button disabled={busy !== null} className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50">{busy === "visit" ? "Saving…" : "Save"}</button>
                {!(s.defaults.ssid && s.defaults.psk) && <button type="button" disabled={busy !== null} onClick={() => call("default", "visit", "PUT", { ssid: null, psk: null }, "Back to hotspot / 12345678.")} className={button}>Use the default</button>}
                <span className="text-xs">{s.nodeHas ? <span className="text-green-800">The node has it.</span> : <span className="text-amber-700">The node takes it when the visit starts.</span>}</span>
              </div>
              <p className="text-xs text-muted">On an iPhone the name is the phone&apos;s name (Settings, General, About) and the password is under Settings, Personal Hotspot; turn on Maximise Compatibility there. On Android: Settings, Hotspot, with WPA2 or WPA2/WPA3, not WPA3 alone. Capitals, spaces and the kind of apostrophe do not matter.</p>
            </form>
          </li>
          <li className="flex gap-3">
            <span className={step}>2</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">At the node</div>
              <p>Turn on your hotspot and keep its screen open. Then hold the magnet on the mark for three seconds, or press the button on a sleeping node once. Within two minutes the node joins your phone, which then shows a connection; come back to this page to see the clips arrive.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className={step}>3</span>
            <div className="min-w-0 flex-1" aria-live="polite">
              <div className="font-medium">Follow it here</div>
              {line ? <div className={`mt-1 rounded border p-2 ${TONE[line.tone]}`}>{line.text}</div> : (
                <p className="text-muted">
                  {c ? (c.waiting ? `${clips(c.waiting)} wait on the node, as it said at ${when(s.heardAt)}. ` : "Nothing waits on the node now. ") : ""}
                  As soon as the node starts the visit it shows here, and then the clips as they arrive.
                </p>
              )}
            </div>
          </li>
        </ol>

        <details className="mt-5 rounded border border-line p-3">
          <summary className="cursor-pointer font-medium">No phone signal at the node? Use a laptop</summary>
          <div className="mt-2 space-y-2">
            <p>When the node does not find your hotspot within three minutes, it opens a WiFi of its own until the visit ends. The Life Clips app on a laptop joins it, takes the clips, and sends them to the oracle once the laptop is online again; the node deletes them when the oracle has them all.</p>
            <div className="flex flex-wrap gap-2">
              <a className={`${button} inline-block`} href={`${APP}/mac`}>Download for Mac</a>
              <a className={`${button} inline-block`} href={`${APP}/windows`}>Download for Windows</a>
            </div>
            <div>The node&apos;s WiFi <code className="ml-1">{s.apSsid}</code>, password <code className="ml-1">{s.apPsk}</code></div>
            <button type="button" disabled={busy !== null} onClick={() => call("ap", "visit", "PUT", { apPsk: null }, "A new password. The node takes it when the visit starts.")} className={button}>Draw a new password</button>
          </div>
        </details>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2 text-sm">
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

        {night && <NightWindow place={place} state={night} zone={zone} />}
      </div>
      {config && <NodeSettings place={place} state={config} zone={zone} />}
    </section>
  );
}
