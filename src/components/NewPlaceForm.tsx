"use client";
import { useState } from "react";
import LifeMap from "./LifeMap";

export default function NewPlaceForm() {
  const [ring, setRing] = useState<[number, number][]>([]);
  const [name, setName] = useState("");
  const [landUse, setLandUse] = useState("grassland");
  const [country, setCountry] = useState("NL");
  const [key, setKey] = useState("");
  const [geojsonText, setGeojsonText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; slug?: string; stewardKey?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setResult(null);
    let geometry: unknown = ring.length >= 4 ? { type: "Polygon", coordinates: [ring] } : null;
    if (geojsonText.trim()) { try { geometry = JSON.parse(geojsonText); } catch { setResult({ ok: false, text: "GeoJSON does not parse" }); setBusy(false); return; } }
    if (!geometry) { setResult({ ok: false, text: "Draw at least three points or paste GeoJSON" }); setBusy(false); return; }
    const r = await fetch("/api/v1/places", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ name, landUse, country, geometry }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setResult({ ok: true, text: `Registered ${j.place.name} (${j.place.areaHa.toFixed(2)} ha). Satellite backfill queued.`, slug: j.place.slug, stewardKey: j.stewardKey });
    else setResult({ ok: false, text: `${r.status}: ${j.error ?? "failed"}${j.issues ? " " + JSON.stringify(j.issues) : ""}` });
    setBusy(false);
  }

  return (
    <div className="mt-6 grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2"><LifeMap height="60vh" zoom={8} onDraw={setRing} /></div>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <label className="block">Name<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5 bg-white" placeholder="Achterste weiland, Vegastraat" /></label>
        <label className="block">Land use
          <select value={landUse} onChange={(e) => setLandUse(e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5 bg-white">
            {["grassland", "arable", "construction crops (miscanthus, hemp, straw)", "peat meadow", "agroforestry", "orchard", "forest", "wetland", "heath", "urban green", "other"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label className="block">Country (ISO-2)<input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} className="mt-1 w-24 rounded border border-line px-2 py-1.5 bg-white" /></label>
        <label className="block">Steward or admin key<input required type="password" value={key} onChange={(e) => setKey(e.target.value)} className="mt-1 w-full rounded border border-line px-2 py-1.5 bg-white font-mono" placeholder="lo_key_…" /></label>
        <details><summary className="cursor-pointer text-muted">Or paste GeoJSON instead of drawing</summary>
          <textarea value={geojsonText} onChange={(e) => setGeojsonText(e.target.value)} rows={5} className="mt-1 w-full rounded border border-line px-2 py-1.5 bg-white font-mono text-xs" placeholder='{"type":"Polygon","coordinates":[[[lon,lat],…]]}' />
        </details>
        <div className="text-xs text-muted">{ring.length >= 4 ? `${ring.length - 1} points drawn` : "no boundary yet"}</div>
        <button disabled={busy} className="px-4 py-2 rounded-md bg-accent text-white disabled:opacity-50">{busy ? "Registering…" : "Register place"}</button>
        {result && (
          <div className={`rounded border p-3 ${result.ok ? "border-accent bg-green-50" : "border-red-300 bg-red-50"}`}>
            <div>{result.text}</div>
            {result.stewardKey && <div className="mt-2 text-xs">Steward key for this place (shown once, store it):<br /><code className="break-all">{result.stewardKey}</code></div>}
            {result.slug && <a className="underline block mt-2" href={`/places/${result.slug}`}>Open the place</a>}
          </div>
        )}
      </form>
    </div>
  );
}
