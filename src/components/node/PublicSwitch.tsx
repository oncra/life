"use client";
import { useState } from "react";

// Who sees the node dashboard, a block of the owner's panel (OwnerPanel): everyone, or only the people who may see the
// place exactly. One switch per place, whatever the number of nodes on it. Decided 12 October 2026: a node's dashboard
// is public only while the node is not at a private field site. The API checks who may change it
// (src/lib/privacy.ts canManage).

type Props = { place: string; initial: boolean };

export default function PublicSwitch({ place, initial }: Props) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function set(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/places/${encodeURIComponent(place)}/node/public`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ public: next }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ ok: false, text: j.issues?.[0]?.message ?? j.error ?? `the oracle answered ${r.status}` });
        return;
      }
      setOn(j.public);
      setMsg({ ok: true, text: j.public ? "Public again." : "Private now. The open data and the map follow within a minute." });
    } catch {
      setMsg({ ok: false, text: "No connection to the oracle. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const button = "rounded-md border border-line bg-white px-3 py-1.5 hover:border-accent disabled:opacity-50";
  return (
    <div className="mt-4 max-w-3xl text-sm space-y-2">
      <h3 className="text-base font-semibold">Who sees this page</h3>
      {msg && <div className={`rounded border p-2 ${msg.ok ? "border-accent bg-green-50" : "border-red-300 bg-red-50"}`}>{msg.text}</div>}
      {on ? (
        <p><span className="font-medium text-green-800">Public.</span> Anyone with the link sees this page, the birds it heard and their clips, and the node is on the map, on the globe and in the open data other sites show. Where it stands is never on it.</p>
      ) : (
        <p><span className="font-medium text-amber-700">Private.</span> Only you, the people given access to this place, its steward key and the oracle&apos;s admins see this page, its status, the birds it heard and their clips. Everyone else gets &ldquo;not found&rdquo;, as for a private place, and the node is off the map, the globe and the open data.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => set(!on)} className={button}>{busy ? "Saving…" : on ? "Make it private" : "Make it public"}</button>
        <span className="text-xs text-muted">Keep it private while the node stands on someone&apos;s land. This is the node&apos;s page only; the place page keeps its own setting.</span>
      </div>
    </div>
  );
}
