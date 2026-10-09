"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SignIn } from "@/components/BoxApp";

type Lane = "BACKLOG" | "NEXT" | "DOING" | "DONE";
export type BacklogCard = { id: string; lane: Lane; rank: number; title: string; body: string | null; author: string | null; createdAt: string; updatedAt: string; doneAt: string | null };
type Editor = "key" | "session" | "password" | null;
type At = "top" | "bottom" | { before: string } | { after: string };
type Fields = { title: string; body: string; author: string };

const LANES: { id: Lane; name: string }[] = [
  { id: "BACKLOG", name: "Backlog" },
  { id: "NEXT", name: "Next" },
  { id: "DOING", name: "Doing" },
  { id: "DONE", name: "Done" },
];
const DONE_SHOWN = 12;

const field = "w-full rounded-md border border-line bg-white px-2.5 py-2 text-sm focus:outline-none focus:border-accent";
const primary = "rounded-md bg-accent text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const quiet = "rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50";

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `That did not save (${r.status}). Try again.`), { status: r.status });
  return j;
}

function inLane(cards: BacklogCard[], lane: Lane): BacklogCard[] {
  return cards.filter((c) => c.lane === lane).sort((a, b) => a.rank - b.rank || b.createdAt.localeCompare(a.createdAt));
}

/** The same placement the server makes, so a move shows at once; the server's answer then replaces it. */
function moved(cards: BacklogCard[], id: string, lane: Lane, at: At): BacklogCard[] {
  const others = inLane(cards, lane).filter((c) => c.id !== id);
  let i: number;
  if (at === "top") i = 0;
  else if (at === "bottom") i = others.length;
  else if ("before" in at) { const j = others.findIndex((o) => o.id === at.before); i = j < 0 ? 0 : j; }
  else { const j = others.findIndex((o) => o.id === at.after); i = j < 0 ? others.length : j + 1; }
  const prev = others[i - 1]?.rank;
  const next = others[i]?.rank;
  const rank = prev === undefined ? (next === undefined ? 0 : next - 1) : next === undefined ? prev + 1 : (prev + next) / 2;
  return cards.map((c) => (c.id === id ? { ...c, lane, rank, doneAt: lane === c.lane ? c.doneAt : lane === "DONE" ? new Date().toISOString() : null } : c));
}

const day = (ts: string) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });

/** Plain text with its web addresses made clickable. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])/g);
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow ugc" className="underline break-all">{p.replace(/^https?:\/\/(www\.)?/, "")}</a> : p))}</>;
}

export function Backlog({ initial, editor: initialEditor }: { initial: BacklogCard[]; editor: Editor }) {
  const [cards, setCards] = useState(initial);
  const [editor, setEditor] = useState<Editor>(initialEditor);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Lane>("BACKLOG");
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ lane: Lane; index: number } | null>(null);
  const [allDone, setAllDone] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/backlog", { cache: "no-store" }).catch(() => null);
    if (!r?.ok || busy.current) return;
    const j = await r.json();
    setCards(j.cards);
    setEditor(j.editor);
  }, []);

  // Someone else may be moving cards too: catch up when the page comes back into view, and twice a minute while it is.
  useEffect(() => {
    const look = () => { if (document.visibilityState === "visible" && !busy.current) refresh(); };
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    const t = setInterval(look, 30000);
    return () => { window.removeEventListener("focus", look); document.removeEventListener("visibilitychange", look); clearInterval(t); };
  }, [refresh]);

  async function save(run: () => Promise<{ cards: BacklogCard[] }>, optimistic?: (c: BacklogCard[]) => BacklogCard[]): Promise<boolean> {
    const before = cards;
    if (optimistic) setCards(optimistic);
    busy.current = true;
    try {
      const j = await run();
      setCards(j.cards);
      setError(null);
      return true;
    } catch (e) {
      setCards(before);
      const err = e as Error & { status?: number };
      if (err.status === 401) { setEditor(null); setEditing(null); setError("The board is locked again. Type the password to go on."); }
      else setError(err.message);
      return false;
    } finally {
      busy.current = false;
    }
  }

  const add = (f: Fields) => save(() => call("/api/backlog", "POST", { title: f.title, body: f.body || undefined, author: f.author || undefined }));
  const edit = (id: string, f: Fields) => save(() => call(`/api/backlog/${id}`, "PATCH", { title: f.title, body: f.body || null, author: f.author || null }), (cs) => cs.map((c) => (c.id === id ? { ...c, title: f.title.trim(), body: f.body.trim() || null, author: f.author.trim() || null } : c)));
  const remove = (id: string) => save(() => call(`/api/backlog/${id}`, "DELETE"), (cs) => cs.filter((c) => c.id !== id));
  const move = (id: string, lane: Lane, at: At = "top") => save(() => call(`/api/backlog/${id}`, "PATCH", { lane, at }), (cs) => moved(cs, id, lane, at));

  async function lock() {
    await call("/api/backlog/unlock", "DELETE").catch(() => null);
    setEditing(null);
    await refresh();
  }

  // Drag and drop (mouse): the drop index counts the cards as they are shown, the dragged one included.
  function over(e: React.DragEvent<HTMLElement>, lane: Lane) {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"));
    let index = items.length;
    for (let k = 0; k < items.length; k++) {
      const r = items[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = k; break; }
    }
    if (drop?.lane !== lane || drop.index !== index) setDrop({ lane, index });
  }
  function dropped(e: React.DragEvent<HTMLElement>, lane: Lane) {
    e.preventDefault();
    const id = drag;
    const at = drop?.lane === lane ? drop.index : null;
    setDrag(null); setDrop(null);
    if (!id || at === null) return;
    const shown = inLane(cards, lane);
    const target = shown[at]?.id === id ? shown[at + 1] : shown[at];
    const self = cards.find((c) => c.id === id);
    if (self?.lane === lane && (shown[at]?.id === id || shown[at - 1]?.id === id)) return; // dropped where it already was
    move(id, lane, target ? { before: target.id } : "bottom");
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Backlog</h1>
          <p className="mt-1 text-muted">Ideas we come across while building the Life Node and the oracle.</p>
        </div>
        {!editor && <Unlock onDone={refresh} />}
        {editor === "password" && <button type="button" onClick={lock} className="text-sm text-muted underline">Lock</button>}
      </div>
      {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="md:hidden mt-5 grid grid-cols-4 gap-1 rounded-lg border border-line bg-white p-1 text-sm" role="tablist">
        {LANES.map((l) => (
          <button key={l.id} type="button" role="tab" aria-selected={tab === l.id} onClick={() => setTab(l.id)} className={`rounded-md px-1 py-1.5 ${tab === l.id ? "bg-accent text-white font-medium" : "text-muted"}`}>
            {l.name} <span className="opacity-70">{inLane(cards, l.id).length}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 md:mt-6 grid md:grid-cols-4 gap-3 items-start">
        {LANES.map((l, li) => {
          const list = inLane(cards, l.id);
          const shown = l.id === "DONE" && !allDone && !drag ? list.slice(0, DONE_SHOWN) : list;
          return (
            <section
              key={l.id}
              aria-label={l.name}
              className={`rounded-xl bg-[#f1efe6] p-2 ${tab === l.id ? "" : "hidden md:block"} ${drop?.lane === l.id ? "ring-2 ring-accent/30" : ""}`}
              onDragOver={(e) => over(e, l.id)}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}
              onDrop={(e) => dropped(e, l.id)}
            >
              <h2 className="hidden md:flex items-baseline justify-between px-1.5 pt-0.5 pb-2 text-sm font-semibold">
                {l.name} <span className="font-normal text-muted">{list.length}</span>
              </h2>
              {l.id === "BACKLOG" && editor && <AddCard onAdd={add} />}
              <ul className="grid gap-2">
                {shown.map((c, k) => (
                  <li key={c.id} className="contents">
                    {drop?.lane === l.id && drop.index === k && <div className="h-1 rounded bg-accent" />}
                    {editing === c.id ? (
                      <EditCard card={c} onCancel={() => setEditing(null)} onSave={async (f) => { if (await edit(c.id, f)) setEditing(null); }} onDelete={async () => { if (await remove(c.id)) setEditing(null); }} />
                    ) : (
                      <CardView
                        card={c}
                        editable={!!editor}
                        dragging={drag === c.id}
                        prev={LANES[li - 1]}
                        next={LANES[li + 1]}
                        onOpen={() => setEditing(c.id)}
                        onMove={(lane) => move(c.id, lane)}
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.title); setDrag(c.id); }}
                        onDragEnd={() => { setDrag(null); setDrop(null); }}
                      />
                    )}
                  </li>
                ))}
                {drop?.lane === l.id && drop.index >= shown.length && <li className="h-1 rounded bg-accent" />}
              </ul>
              {list.length === 0 && !(l.id === "BACKLOG" && editor) && <p className="px-1.5 py-2 text-sm text-muted">Nothing here yet.</p>}
              {shown.length < list.length && (
                <button type="button" onClick={() => setAllDone(true)} className="mt-2 w-full rounded-md py-1.5 text-sm text-muted hover:text-foreground">
                  Show all {list.length}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CardView({ card, editable, dragging, prev, next, onOpen, onMove, onDragStart, onDragEnd }: {
  card: BacklogCard; editable: boolean; dragging: boolean; prev?: { id: Lane; name: string }; next?: { id: Lane; name: string };
  onOpen: () => void; onMove: (lane: Lane) => void; onDragStart: (e: React.DragEvent<HTMLElement>) => void; onDragEnd: () => void;
}) {
  const meta = [card.author, card.lane === "DONE" && card.doneAt ? `done ${day(card.doneAt)}` : day(card.createdAt)].filter(Boolean).join(" · ");
  return (
    <div
      data-card
      draggable={editable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`bl-card rounded-lg border border-line bg-white p-2.5 text-sm ${dragging ? "opacity-40" : ""} ${editable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div
        onClick={(e) => { if (editable && !(e.target as HTMLElement).closest("a")) onOpen(); }}
        className={editable ? "cursor-text" : ""}
      >
        <p className="font-medium leading-snug break-words">{card.title}</p>
        {card.body && <p className="mt-1 text-muted whitespace-pre-wrap break-words leading-snug"><Linked text={card.body} /></p>}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{meta}</span>
        {editable && (
          <span className="bl-moves ml-auto flex shrink-0 gap-1">
            {prev && <button type="button" onClick={() => onMove(prev.id)} className="rounded border border-line px-1.5 py-0.5 hover:border-accent hover:text-foreground">← {prev.name}</button>}
            {next && <button type="button" onClick={() => onMove(next.id)} className="rounded border border-line px-1.5 py-0.5 hover:border-accent hover:text-foreground">{next.name} →</button>}
          </span>
        )}
      </div>
    </div>
  );
}

function EditCard({ card, onSave, onCancel, onDelete }: { card: BacklogCard; onSave: (f: Fields) => void; onCancel: () => void; onDelete: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body ?? "");
  const [author, setAuthor] = useState(card.author ?? "");
  const submit = () => { if (title.trim()) onSave({ title, body, author }); };
  return (
    <form
      data-card
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
      className="grid gap-2 rounded-lg border border-accent bg-white p-2.5 text-sm"
    >
      <textarea value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); submit(); } }} required maxLength={200} rows={3} autoFocus aria-label="Title" className={`${field} font-medium resize-none field-sizing-content`} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} placeholder="Details, links" aria-label="Details" className={field} />
      <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={60} placeholder="Name" aria-label="Name" className={field} />
      <div className="flex flex-wrap items-center gap-2">
        <button className={primary} disabled={!title.trim()}>Save</button>
        <button type="button" onClick={onCancel} className={quiet}>Cancel</button>
        <button type="button" onClick={() => { if (confirm(`Delete "${card.title}"?`)) onDelete(); }} className="ml-auto text-red-700 underline">Delete</button>
      </div>
    </form>
  );
}

function AddCard({ onAdd }: { onAdd: (f: Fields) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    localStorage.setItem("lifebox.author", author.trim());
    const ok = await onAdd({ title, body, author });
    setBusy(false);
    if (ok) { setTitle(""); setBody(""); setOpen(false); }
  }
  return (
    <form onSubmit={submit} onKeyDown={(e) => { if (e.key === "Escape" && !title.trim() && !body.trim()) { setOpen(false); (e.target as HTMLElement).blur(); } }} className="mb-2 grid gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => { if (!open) { setOpen(true); setAuthor(localStorage.getItem("lifebox.author") ?? ""); } }} maxLength={200} placeholder="A new idea" aria-label="A new idea" className={field} />
      {(open || title || body) && (
        <>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} placeholder="Details, links (optional)" aria-label="Details" className={field} />
          <div className="flex gap-2">
            <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={60} placeholder="Your name" aria-label="Your name" className={`${field} min-w-0 flex-1`} />
            <button className={primary} disabled={busy || !title.trim()}>Add</button>
          </div>
        </>
      )}
    </form>
  );
}

function Unlock({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await call("/api/backlog/unlock", "POST", { password }); setPassword(""); onDone(); } catch (x) { setError((x as Error).message); }
    setBusy(false);
  }
  return (
    <div className="w-full sm:w-auto">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input type="text" name="username" autoComplete="username" value="backlog" readOnly hidden />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password to edit" aria-label="Password to edit" autoComplete="current-password" required className={`${field} w-auto min-w-0 flex-1 sm:w-48 sm:flex-none`} />
        <button className={primary} disabled={busy || !password}>Unlock</button>
        <button type="button" onClick={() => setSignIn((s) => !s)} className="text-sm text-muted underline">or sign in</button>
      </form>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      {signIn && (
        <div className="mt-3 rounded-lg border border-line bg-white p-4 sm:max-w-sm">
          <SignIn compact title="Sign in" intro="We send a six-digit code to your email." />
        </div>
      )}
    </div>
  );
}
