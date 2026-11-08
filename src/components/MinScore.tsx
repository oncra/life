"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// The lowest detector score /triage shows, in percent. A change goes into the address (?min=), so the page lists
// only the clips from that score up and the setting can be shared; the default leaves the address clean.
export function MinScore({ value, standard }: { value: number; standard: number }) {
  const router = useRouter();
  const [v, setV] = useState(String(value));
  const [pending, start] = useTransition();
  useEffect(() => {
    const n = Number(v);
    if (v === "" || !Number.isFinite(n) || n < 0 || n > 100 || Math.round(n) === value) return;
    const t = setTimeout(() => start(() => router.replace(Math.round(n) === standard ? "/triage" : `/triage?min=${Math.round(n)}`, { scroll: false })), 400);
    return () => clearTimeout(t);
  }, [v, value, standard, router]);
  return (
    <label className="mt-3 inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm">
      <span className="font-medium">Lowest score</span>
      <input type="number" inputMode="numeric" min={0} max={100} step={5} value={v} onChange={(e) => setV(e.target.value)}
        className="w-16 rounded border border-line px-2 py-0.5 text-right" aria-label="Lowest detector score shown, in percent" />
      <span>%</span>
      {pending ? <span className="text-xs text-muted">loading…</span> : null}
    </label>
  );
}
