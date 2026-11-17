"use client";
import { useState } from "react";

// The place's exact location, shown or hidden behind a circle (Place.locationHidden, src/lib/privacy.ts): a block of
// the owner's panel (OwnerPanel). Decided 17 November 2026: a node's data is never hidden, because sharing it is the
// point; at a private field site what is kept back is where exactly the node stands. It sets the place's own setting
// through PATCH /api/v1/places/{id}, which takes a signed-in owner for this one field (canManage) and keeps the
// circle's centre once it is drawn.

type Props = { place: string; hidden: boolean; isPublic: boolean; radiusM: number };

const size = (m: number) => (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${m} m`);

export default function LocationSwitch({ place, hidden: initial, isPublic, radiusM: initialRadius }: Props) {
  const [hidden, setHidden] = useState(initial);
  const [radiusM, setRadiusM] = useState(initialRadius);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function set(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/places/${encodeURIComponent(place)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationHidden: next }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.place) {
        setMsg({ ok: false, text: j.issues?.[0]?.message ?? j.error ?? `the oracle answered ${r.status}` });
        return;
      }
      setHidden(j.place.locationHidden);
      if (typeof j.place.blurRadiusM === "number") setRadiusM(j.place.blurRadiusM);
      setMsg({ ok: true, text: j.place.locationHidden ? "Hidden." : "Shown." });
    } catch {
      setMsg({ ok: false, text: "No connection to the oracle. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const button = "rounded-md border border-line bg-white px-3 py-1.5 hover:border-accent disabled:opacity-50";
  return (
    <div className="mt-4 max-w-3xl text-sm space-y-2">
      <h3 className="text-base font-semibold">Its exact location</h3>
      {msg && <div className={`rounded border p-2 ${msg.ok ? "border-accent bg-green-50" : "border-red-300 bg-red-50"}`}>{msg.text}</div>}
      {hidden ? (
        <p><span className="font-medium text-amber-700">Hidden.</span> Everyone else sees a circle of {size(radiusM)} around a point drawn once, here, on the map and on the globe{isPublic ? ", and on the place page" : ""}. You, the people given access to this place, its steward key and the oracle&apos;s admins see where it stands.</p>
      ) : isPublic ? (
        <p><span className="font-medium text-green-800">Shown.</span> Everyone sees where it stands: the point here, on the map and on the globe, and the boundary on the place page.</p>
      ) : (
        <p><span className="font-medium text-green-800">Rounded.</span> The place is private, so everyone else sees the node only as a point rounded to about 7 km, on the map and on the globe. Hidden, they see a circle of {size(radiusM)} instead, and it stays a circle if the place is made public.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => set(!hidden)} className={button}>{busy ? "Saving…" : hidden ? "Show the exact location" : "Hide the exact location"}</button>
        <span className="text-xs text-muted">Hide it while the node stands on someone&apos;s land. What the node hears stays public either way: this page, the birds and their clips, the map and the open data.</span>
      </div>
    </div>
  );
}
