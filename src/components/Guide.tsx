"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Step = { id: string; n: number; title: string };
type Section = { anchor: string; title: string; steps: Step[] };
const KEY = "lifebox-done-v1";

// The one-page build guide's frame: the steps column on the left (where you are, what you ticked), and a bar that
// stays at the top with the current step and a "done, next" button. The guide itself is server-rendered children.
export function Guide({ sections, children }: { sections: Section[]; children: React.ReactNode }) {
  const steps = useMemo(() => sections.flatMap((s) => s.steps), [sections]);
  const [current, setCurrent] = useState<string>(steps[0]?.id ?? "");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); if (Array.isArray(v)) setDone(new Set(v)); } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const save = (next: Set<string>) => { setDone(next); try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch {} };
  const toggle = (id: string) => { const next = new Set(done); if (next.has(id)) next.delete(id); else next.add(id); save(next); };

  // scroll-spy: the current step is the last heading that has passed under the sticky bar
  useEffect(() => {
    let raf = 0;
    const heads = steps.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let cur = steps[0]?.id ?? "";
        for (const h of heads) if (h.getBoundingClientRect().top < 160) cur = h.id;
        setCurrent(cur);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [steps]);

  // mark the current step on the page itself, so the eye finds it too
  useEffect(() => {
    document.querySelectorAll(".step-head").forEach((h) => {
      h.classList.toggle("is-current", h.id === current);
      h.classList.toggle("is-done", done.has(h.id));
    });
  }, [current, done]);

  const go = useCallback((id: string) => {
    setOpen(false);
    const el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#${id}`); }
  }, []);

  const i = Math.max(0, steps.findIndex((s) => s.id === current));
  const step = steps[i];
  const next = steps[i + 1];
  const pct = steps.length ? Math.round((done.size / steps.length) * 100) : 0;
  const doneNext = () => { if (step) { const s = new Set(done); s.add(step.id); save(s); } if (next) go(next.id); };

  const list = (
    <nav aria-label="Build steps" className="text-sm">
      {sections.map((sec) => (
        <div key={sec.anchor} className="mb-4">
          <a href={`#${sec.anchor}`} onClick={(e) => { e.preventDefault(); go(sec.anchor); }} className="block font-semibold text-foreground mb-1">{sec.title}</a>
          <ol className="grid gap-0.5">
            {sec.steps.map((s) => {
              const isCur = s.id === current, isDone = done.has(s.id);
              return (
                <li key={s.id} className={`flex items-start gap-2 rounded-md px-1.5 py-1 ${isCur ? "bg-accent/10" : ""}`}>
                  <button type="button" aria-label={isDone ? `Step ${s.n} done; untick` : `Tick step ${s.n} as done`} onClick={() => toggle(s.id)}
                    className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border text-[0.65rem] leading-none flex items-center justify-center ${isDone ? "bg-accent border-accent text-white" : isCur ? "border-accent text-accent" : "border-line text-muted"}`}>
                    {isDone ? "✓" : s.n}
                  </button>
                  <a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); go(s.id); }} className={`${isCur ? "text-foreground font-medium" : "text-muted hover:text-foreground"}`}>{s.title}</a>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      <aside className="hidden lg:block">
        <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-6 pr-2">
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wide text-muted">Your progress</div>
            <div className="mt-1 h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
            <div className="mt-1 text-xs text-muted">{done.size} of {steps.length} steps done</div>
          </div>
          {list}
        </div>
      </aside>
      <div className="min-w-0">
        <div className="sticky top-12 md:top-14 z-[900] -mx-4 px-4 lg:mx-0 lg:px-0 bg-background border-b border-line">
          <div className="flex items-center gap-3 py-2">
            <button type="button" onClick={() => setOpen(!open)} className="lg:hidden shrink-0 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm" aria-expanded={open}>Steps</button>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">Step {step?.n ?? 1} of {steps.length}</div>
              <div className="truncate font-medium">{step?.title}</div>
            </div>
            {next ? (
              <button type="button" onClick={doneNext} className="shrink-0 rounded-md bg-accent text-white px-3 py-1.5 text-sm font-medium">Done, next</button>
            ) : (
              <button type="button" onClick={() => step && toggle(step.id)} className="shrink-0 rounded-md bg-accent text-white px-3 py-1.5 text-sm font-medium">{step && done.has(step.id) ? "Done" : "Mark done"}</button>
            )}
          </div>
          <div className="h-0.5 bg-line -mx-4 lg:mx-0"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
          {open && <div className="lg:hidden max-h-[65vh] overflow-y-auto py-3 border-t border-line">{list}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
