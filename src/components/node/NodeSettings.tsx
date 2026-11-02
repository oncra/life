"use client";
import { useState } from "react";
import type { ConfigState } from "@/lib/node-config";
import type { WindowRule } from "@/lib/listening";
import { clockLabel } from "@/lib/clock";

// The owner's settings over 4G (src/lib/node-config.ts): a short list of the node's own settings, sent with the
// method's listening windows in the answer to its next post and checked again on the node (node/life-config.py).
// Shown only to whoever may run the node; the API checks again.

type Props = { place: string; state: ConfigState; zone: string };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ANCHOR: Record<string, string> = { dawn: "civil dawn", sunrise: "sunrise", noon: "solar noon", sunset: "sunset", dusk: "civil dusk", clock: "the clock" };

function monthsText(m: WindowRule["months"]): string {
  if (Array.isArray(m)) return m.map((x) => MON[x - 1]).join(", ");
  const [a, b] = m.split("-").map(Number);
  if (!b || a === b) return MON[a - 1];
  if ((b - a + 12) % 12 === 11) return "all year";
  return `${MON[a - 1]} to ${MON[b - 1]}`;
}

function length(min: number): string {
  return min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

function ruleText(r: WindowRule): string {
  const from = r.from === "clock" ? r.at ?? "" : r.offset ? `${length(Math.abs(r.offset))} ${r.offset > 0 ? "after" : "before"} ${ANCHOR[r.from]}` : ANCHOR[r.from];
  return `${length(r.min)} from ${from}, ${monthsText(r.months)}`;
}

export default function NodeSettings({ place, state: initial, zone }: Props) {
  const [s, setS] = useState(initial);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const url = `/api/v1/places/${encodeURIComponent(place)}/devices/${encodeURIComponent(s.device)}/config`;

  async function put(label: string, body: unknown, done: string) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ ok: false, text: j.issues?.[0]?.message ?? j.error ?? `the oracle answered ${r.status}` });
        return;
      }
      setS(j as ConfigState);
      setDraft({});
      setMsg({ ok: true, text: done });
    } catch {
      setMsg({ ok: false, text: "No connection to the oracle. Try again." });
    } finally {
      setBusy(null);
    }
  }

  const button = "rounded-md border border-line bg-white px-2.5 py-1 hover:border-accent disabled:opacity-50";
  const input = "rounded border border-line bg-white px-1.5 py-1";
  const t = (iso: string) => clockLabel(Date.parse(iso), zone);
  const groups = [...new Set(s.settings.map((x) => x.group))];
  const changed = Object.keys(draft).filter((k) => draft[k] !== (s.env[k] ?? ""));

  return (
    <div className="mt-6 border-t border-line pt-4 text-sm">
      <h3 className="font-medium">Settings over 4G</h3>
      <p className="text-muted max-w-3xl">The node takes these from the answer to its next post, a few hundred bytes once, and checks every value again itself. If it hears nothing from the oracle in three wakes after a change, it goes back to its last good settings by itself. The SIM, the network and the software cannot be changed from here.</p>
      {msg && <div className={`mt-2 rounded border p-2 ${msg.ok ? "border-accent bg-green-50" : "border-red-300 bg-red-50"}`}>{msg.text}</div>}
      <p className="mt-2">
        {!s.capable ? <span className="text-amber-700">This node does not take settings over the air yet: its software is older. Once, on the bench or at a visit: <code>sudo bash node/apply-config.sh</code>. What you set here waits for it.</span>
          : s.refused ? <span className="text-red-700">The node refused these settings: {s.refused.why ?? "no reason given"}. <button type="button" disabled={busy !== null} onClick={() => put("again", { again: true }, "Sent again.")} className={button}>Send again</button></span>
          : s.nodeHas && s.trial ? <span className="text-green-800">The node has these settings and is trying them: they become its last good ones once the oracle has answered a post made under them.</span>
          : s.nodeHas ? <span className="text-green-800">The node has these settings.</span>
          : <span className="text-amber-700">The node gets these with the answer to its next post, while it is awake.</span>}
        {s.ignored.length > 0 && <span className="text-muted"> It left out what its software does not know: {s.ignored.join(", ")}.</span>}
      </p>

      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="font-medium">Listening windows</h4>
          <p>Today: {s.today.map((w, i) => <span key={i} className="mr-2 inline-block">{w.name} {t(w.start)}–{t(w.end)}</span>)}</p>
          <ul className="list-disc pl-5">{s.method.map((r) => <li key={r.name}>{r.name}: {ruleText(r)}</li>)}</ul>
          <p className="text-xs text-muted">The method&apos;s windows, the same at every node, and the only hours the readings count. They go to the node with its settings, so a new version of the method reaches it without a visit. The meadow-bird window is set above and is never counted.</p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); put("env", { env: Object.fromEntries(changed.map((k) => [k, draft[k] === "" ? null : draft[k]])) }, "Saved."); }} className="space-y-3">
          <h4 className="font-medium">The node&apos;s settings</h4>
          {groups.map((g) => (
            <fieldset key={g}>
              <legend className="text-muted">{g}</legend>
              <div className="space-y-1">{s.settings.filter((x) => x.group === g).map((x) => {
                const set = s.env[x.key];
                const value = draft[x.key] ?? set ?? "";
                const onNode = s.running?.settings[x.key];
                return (
                  <div key={x.key} className="grid grid-cols-[1fr_auto] items-center gap-2" title={x.what}>
                    <label htmlFor={`set-${x.key}`}>{x.label}<span className="block text-xs text-muted">{set !== undefined ? "set here · " : ""}{onNode !== undefined ? `on the node: ${onNode}` : "the node's own"} · {x.kind === "enum" ? x.options.join(" / ") : `${x.min} to ${x.max}`}</span></label>
                    {x.kind === "enum" ? (
                      <select id={`set-${x.key}`} value={value} onChange={(e) => setDraft({ ...draft, [x.key]: e.target.value })} className={input}>
                        <option value="">the node&apos;s own</option>{x.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input id={`set-${x.key}`} type="number" step={x.kind === "int" ? 1 : 0.01} min={x.min} max={x.max} value={value} placeholder="node's own" onChange={(e) => setDraft({ ...draft, [x.key]: e.target.value })} className={`${input} w-24`} />
                    )}
                  </div>
                );
              })}</div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy !== null || changed.length === 0} className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50">{busy === "env" ? "Saving…" : changed.length ? `Save ${changed.length}` : "Save"}</button>
            <span className="text-xs text-muted">An empty field gives the setting back to the node.{s.running ? ` The node last reported its settings at ${t(s.running.at)}.` : ""}</span>
          </div>
        </form>
      </div>
    </div>
  );
}
