"use client";
import { useEffect, useState } from "react";

type Box = {
  id: string; name: string; hostname: string; nodePassword: string; wifiSsid: string | null;
  imageStatus: "BUILDING" | "READY" | "FAILED"; imageError: string | null; imageBytes: number | null;
  builtAt: string | null; placedAt: string | null; placeSlug: string;
  live?: Live;
};
type Live = {
  heardAt: string | null; heartbeatAt: string | null; on4g: boolean;
  detection: { ts: string; species: string; confidence: number } | null;
  soil: { depthCm: number | null; last: { ts: string; vwc: number | null; tempC: number | null } | null }[];
};

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
  return j;
}

const input = "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:outline-none focus:border-accent";
const button = "rounded-lg bg-accent text-white px-4 py-2.5 font-medium disabled:opacity-50";
const quiet = "rounded-lg border border-line bg-white px-4 py-2.5 font-medium hover:border-accent disabled:opacity-50";

export function BoxApp({ email, initial }: { email: string | null; initial: Box[] }) {
  if (!email) return <SignIn />;
  return <Boxes email={email} initial={initial} />;
}

export function SignIn({ title = "The software for your Life Box", intro = "We make a card image for your box with its WiFi already in it. You download it, put it on the memory card, and the box starts sending on its own." }: { title?: string; intro?: string } = {}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await post("/api/box/code", { email }); setSent(true); } catch (x) { setError((x as Error).message); }
    setBusy(false);
  }
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await post("/api/box/login", { email, code }); location.reload(); } catch (x) { setError((x as Error).message); setBusy(false); }
  }
  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-muted">{intro}</p>
      {!sent ? (
        <form onSubmit={send} className="mt-6 grid gap-3">
          <label className="font-medium" htmlFor="email">Your email</label>
          <input id="email" type="email" required autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.org" />
          <button className={button} disabled={busy}>{busy ? "Sending…" : "Send me a code"}</button>
        </form>
      ) : (
        <form onSubmit={signIn} className="mt-6 grid gap-3">
          <label className="font-medium" htmlFor="code">The six digits we sent to {email}</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" required className={`${input} tracking-[0.4em] text-xl`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" autoFocus />
          <button className={button} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <button type="button" className="text-sm text-muted underline justify-self-start" onClick={() => { setSent(false); setCode(""); }}>Use another address, or send a new code</button>
        </form>
      )}
      {error && <p className="mt-3 text-red-700">{error}</p>}
    </div>
  );
}

function Boxes({ email, initial }: { email: string; initial: Box[] }) {
  const [boxes, setBoxes] = useState<Box[]>(initial);
  const [adding, setAdding] = useState(initial.length === 0);
  const building = boxes.some((b) => b.imageStatus === "BUILDING");
  useEffect(() => {
    if (!boxes.length) return;
    const t = setInterval(async () => {
      const r = await fetch("/api/box/boxes");
      if (r.ok) setBoxes((await r.json()).items);
    }, building ? 3000 : 60000);
    return () => clearInterval(t);
  }, [building, boxes.length]);
  async function refresh() { const r = await fetch("/api/box/boxes"); if (r.ok) setBoxes((await r.json()).items); }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{boxes.length > 1 ? "Your Life Boxes" : "Your Life Box"}</h1>
        <button className="text-sm text-muted underline" onClick={async () => { await post("/api/box/logout", {}); location.reload(); }}>Sign out</button>
      </div>
      <p className="text-sm text-muted mt-1">Signed in as {email}</p>
      {adding ? (
        <NewBox first={boxes.length === 0} onDone={async () => { setAdding(false); await refresh(); }} onCancel={boxes.length ? () => setAdding(false) : undefined} />
      ) : (
        <button className={`${quiet} mt-6`} onClick={() => setAdding(true)}>Add another box</button>
      )}
      <div className="mt-6 grid gap-5">
        {boxes.map((b) => <BoxCard key={b.id} box={b} onChange={refresh} />)}
      </div>
    </div>
  );
}

function WifiFields({ ssid, psk, setSsid, setPsk }: { ssid: string; psk: string; setSsid: (s: string) => void; setPsk: (s: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label className="font-medium mt-2" htmlFor="ssid">WiFi name</label>
      <input id="ssid" className={input} value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="the network where you will switch it on" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <label className="font-medium mt-2" htmlFor="psk">WiFi password</label>
      <div className="flex gap-2">
        <input id="psk" type={show ? "text" : "password"} className={input} value={psk} onChange={(e) => setPsk(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button type="button" className={quiet} onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
      </div>
      <p className="text-sm text-muted">Capitals and spaces count. A box that goes straight to the field uses its 4G stick: leave both empty.</p>
    </>
  );
}

function NewBox({ first, onDone, onCancel }: { first: boolean; onDone: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(first ? "My Life Box" : "");
  const [ssid, setSsid] = useState("");
  const [psk, setPsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await post("/api/box/boxes", { name, ssid, psk }); onDone(); } catch (x) { setError((x as Error).message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="mt-6 grid gap-2 rounded-xl border border-line bg-white/60 p-4">
      <label className="font-medium" htmlFor="name">Name of the box</label>
      <input id="name" required className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Back field" />
      <WifiFields ssid={ssid} psk={psk} setSsid={setSsid} setPsk={setPsk} />
      <p className="text-sm text-muted">Where the box stands comes later, when you put it in the ground.</p>
      <div className="flex gap-3 mt-2">
        <button className={button} disabled={busy}>{busy ? "Starting…" : "Make the software for this box"}</button>
        {onCancel && <button type="button" className={quiet} onClick={onCancel}>Cancel</button>}
      </div>
      {error && <p className="text-red-700">{error}</p>}
    </form>
  );
}

function BoxCard({ box, onChange }: { box: Box; onChange: () => void }) {
  const [rebuild, setRebuild] = useState(false);
  return (
    <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <h2 className="text-xl font-semibold">{box.name}</h2>
      <p className="text-sm text-muted">{box.wifiSsid ? <>WiFi: {box.wifiSsid}</> : box.imageStatus === "READY" ? "No WiFi: uses the 4G stick" : null}</p>

      {box.imageStatus === "BUILDING" && (
        <div className="mt-4 flex items-center gap-3"><span className="inline-block w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" /> Making the software… about a minute.</div>
      )}
      {box.imageStatus === "FAILED" && (
        <div className="mt-4 text-red-700">Making the software failed{box.imageError ? `: ${box.imageError}` : ""}. <button className="underline" onClick={() => setRebuild(true)}>Try again</button></div>
      )}
      {box.imageStatus === "READY" && (
        <>
          <ol className="mt-4 grid gap-4">
            <li>
              <div className="font-medium">1. Download the software</div>
              <a href={`/api/box/boxes/${box.id}/download`} className={`${button} inline-block mt-2`}>Download ({box.imageBytes ? `${Math.round(box.imageBytes / 1e6)} MB` : "about 0.9 GB"})</a>
              <p className="text-sm text-muted mt-1">It is made for this box only. Do not share it: your WiFi password is inside.</p>
            </li>
            <li>
              <div className="font-medium">2. Put it on the memory card</div>
              <p className="text-sm mt-1">Install <a className="underline" href="https://www.raspberrypi.com/software/">Raspberry Pi Imager</a> and open it. Device: Raspberry Pi 4. Operating system: scroll down to <em>Use custom</em> and pick the file you just downloaded. Storage: the memory card. When it asks about custom settings, choose <em>No</em>: everything is already in the file.</p>
            </li>
            <li>
              <div className="font-medium">3. Switch the box on</div>
              <p className="text-sm mt-1">Card in, power on. The first start takes a few minutes. Then the box sends what it hears and measures by itself.</p>
            </li>
          </ol>
          {box.live && <Lights live={box.live} />}
          <Place box={box} onChange={onChange} />
        </>
      )}

      {rebuild ? (
        <Rebuild box={box} onDone={() => { setRebuild(false); onChange(); }} onCancel={() => setRebuild(false)} />
      ) : box.imageStatus === "READY" ? (
        <button className="mt-5 text-sm underline text-muted" onClick={() => setRebuild(true)}>Another WiFi? Make new software for this box</button>
      ) : null}

      <details className="mt-4 text-sm text-muted">
        <summary className="cursor-pointer">For people who want to log in to the box</summary>
        <p className="mt-2">On the same WiFi: <code className="bg-[#f1efe6] px-1 rounded">ssh life@{box.hostname}.local</code>, password <code className="bg-[#f1efe6] px-1 rounded">{box.nodePassword}</code>. You never need this to use the box.</p>
      </details>
    </section>
  );
}

function Place({ box, onChange }: { box: Box; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  async function save(lat: number, lon: number) {
    setBusy(true); setError("");
    try { await post(`/api/box/boxes/${box.id}/place`, { lat, lon }); onChange(); } catch (x) { setError((x as Error).message); }
    setBusy(false);
  }
  function here() {
    if (!navigator.geolocation) { setError("This browser cannot tell where you are. Type the location below."); return; }
    setBusy(true); setError("");
    navigator.geolocation.getCurrentPosition(
      (p) => save(Math.round(p.coords.latitude * 1e5) / 1e5, Math.round(p.coords.longitude * 1e5) / 1e5),
      () => { setBusy(false); setError("The location was not shared. Allow it, or type it below."); },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }
  if (box.placedAt) {
    return (
      <div className="mt-5 rounded-lg bg-[#f1efe6] p-3 text-sm">
        <span className="font-medium">In the ground</span> since {new Date(box.placedAt).toLocaleDateString()}. <a className="underline" href={`/places/${box.placeSlug}`}>See what it measures</a>
      </div>
    );
  }
  return (
    <div className="mt-5 rounded-lg border border-dashed border-line p-3">
      <div className="font-medium">4. When it goes in the ground</div>
      <p className="text-sm mt-1">Stand next to the box with your phone and press the button. Until then it can stay on your desk.</p>
      <button className={`${quiet} mt-2`} disabled={busy} onClick={here}>{busy ? "Finding you…" : "The box is here"}</button>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const m = manual.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/); if (m) save(+m[1], +m[2]); else setError("Type it as latitude, longitude, e.g. 52.38, 4.90"); }}>
        <input className={`${input} text-sm py-2`} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="or type it: 52.38, 4.90" />
        <button className={quiet} disabled={busy || !manual}>Save</button>
      </form>
      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  );
}

function Rebuild({ box, onDone, onCancel }: { box: Box; onDone: () => void; onCancel: () => void }) {
  const [ssid, setSsid] = useState(box.wifiSsid ?? "");
  const [psk, setPsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await post(`/api/box/boxes/${box.id}/image`, { ssid, psk }); onDone(); } catch (x) { setError((x as Error).message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="mt-5 grid gap-2 rounded-lg border border-line p-3">
      <WifiFields ssid={ssid} psk={psk} setSsid={setSsid} setPsk={setPsk} />
      <p className="text-sm text-muted">The new software replaces the old one: a card with the old software stops sending.</p>
      <div className="flex gap-3"><button className={button} disabled={busy}>Make new software</button><button type="button" className={quiet} onClick={onCancel}>Cancel</button></div>
      {error && <p className="text-red-700">{error}</p>}
    </form>
  );
}

function ago(ts: string | null | undefined, now: number): string {
  if (!ts || !now) return "";
  const m = Math.round((now - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

// The builder's test lights: each step of the build guide ends in "this one turns green".
function Lights({ live }: { live: Live }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  const recent = (ts: string | null | undefined, hours: number) => !!ts && !!now && now - new Date(ts).getTime() < hours * 3600e3;
  const rows: { ok: boolean; label: string; text: string }[] = [
    { ok: recent(live.heardAt, 2), label: "The box is on", text: live.heardAt ? `last heard ${ago(live.heardAt, now)}` : "not heard from yet" },
    { ok: !!live.detection, label: "Microphone", text: live.detection ? `${live.detection.species}, ${Math.round(live.detection.confidence * 100)}% sure, ${ago(live.detection.ts, now)}` : "no bird heard yet" },
    ...live.soil.map((p) => ({
      ok: !!p.last,
      label: `Soil probe ${p.depthCm ?? "?"} cm`,
      text: p.last ? `${p.last.vwc ?? "?"}% moisture, ${p.last.tempC ?? "?"} °C, ${ago(p.last.ts, now)}` : "no reading yet",
    })),
    { ok: live.on4g, label: "4G", text: live.on4g ? "the stick has a mobile network" : "no 4G stick seen yet" },
  ];
  return (
    <div className="mt-5 rounded-lg border border-line p-3">
      <div className="font-medium">What the box has sent</div>
      <p className="text-sm text-muted">On the desk the box wakes once an hour for 15 minutes; this page checks every minute.</p>
      <ul className="mt-2 grid gap-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2">
            <span className={`mt-1 inline-block w-3 h-3 rounded-full shrink-0 ${r.ok ? "bg-accent" : "border border-line bg-white"}`} />
            <span><span className="font-medium">{r.label}</span> <span className="text-muted">{r.text}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
