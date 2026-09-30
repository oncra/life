"use client";
import { useCallback, useEffect, useState } from "react";

type Item = { id: string; kind: "NOTE" | "AI_CHANGE"; status: string; body: string; author: string | null; note: string | null; changeUrl: string | null; createdAt: string };

const statusText: Record<string, string> = {
  NEW: "note", QUEUED: "queued for the AI", RUNNING: "the AI is working on it", DONE: "changed", BLOCKED: "held: needs a human", DISMISSED: "dismissed",
};

export function Feedback({ page }: { page: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const [code, setCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/lifebox/feedback?page=${encodeURIComponent(page)}`, { cache: "no-store" });
    if (r.ok) setItems((await r.json()).items);
  }, [page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setAuthor(localStorage.getItem("lifebox.author") ?? "");
    setCode(localStorage.getItem("lifebox.code") ?? "");
  }, []);
  useEffect(() => {
    if (!items.some((i) => i.status === "QUEUED" || i.status === "RUNNING")) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [items, load]);

  async function submit(kind: "NOTE" | "AI_CHANGE") {
    if (body.trim().length < 3) { setMsg("Write a sentence first."); return; }
    if (kind === "AI_CHANGE" && !code) { setAskCode(true); setMsg("An AI change needs the change code. Ask the plan's owner for it once; it is remembered in this browser."); return; }
    setBusy(true); setMsg(null);
    localStorage.setItem("lifebox.author", author);
    if (code) localStorage.setItem("lifebox.code", code);
    const r = await fetch("/api/lifebox/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page, kind, body, author: author || undefined, code: kind === "AI_CHANGE" ? code : undefined }) });
    setBusy(false);
    if (r.status === 403) { setAskCode(true); setMsg("That change code is not right."); return; }
    if (!r.ok) { setMsg(`Could not save (${r.status}).`); return; }
    setBody("");
    setMsg(kind === "AI_CHANGE" ? "Queued. The AI picks it up within about ten minutes, changes the plan, and reports here." : "Saved. It is shown on this page.");
    load();
  }

  return (
    <section className="mt-12 rounded-lg border border-line bg-white p-4 md:p-5" id="feedback">
      <h2 className="text-lg font-semibold">Feedback on this page</h2>
      <p className="text-sm text-muted mt-1">A note is shown here for everyone. An AI change is applied to the plan by an AI running on the maintainer&apos;s own account: it edits these pages (and the bench log), publishes, and writes back what it did or why it held off.</p>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder="What is wrong, missing, or should be measured here?" className="mt-3 w-full rounded-md border border-line p-2 text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={60} placeholder="Your name (optional)" className="rounded-md border border-line p-2 text-sm w-full sm:w-44" />
        {askCode && <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={80} placeholder="Change code" className="rounded-md border border-line p-2 text-sm w-full sm:w-40" type="password" />}
        <button disabled={busy} onClick={() => submit("NOTE")} className="rounded-md border border-line px-3 py-2 text-sm hover:border-accent disabled:opacity-50">Leave a note</button>
        <button disabled={busy} onClick={() => submit("AI_CHANGE")} className="rounded-md bg-accent text-white px-3 py-2 text-sm font-medium disabled:opacity-50">AI change</button>
        {!askCode && <button type="button" onClick={() => setAskCode(true)} className="text-xs text-muted underline">have a change code?</button>}
      </div>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
      {items.length > 0 && (
        <ul className="mt-5 space-y-3">
          {items.map((i) => (
            <li key={i.id} className="text-sm border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className={`rounded-full px-2 py-0.5 ${i.kind === "AI_CHANGE" ? "bg-[#f1efe6]" : "border border-line"}`}>{i.kind === "AI_CHANGE" ? "AI change" : "note"}</span>
                <span>{statusText[i.status] ?? i.status}</span>
                {i.author && <span>by {i.author}</span>}
                <span>{new Date(i.createdAt).toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{i.body}</p>
              {i.note && <p className="mt-1 text-muted">→ {i.note}{i.changeUrl && <> (<a className="underline" href={i.changeUrl}>change</a>)</>}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
