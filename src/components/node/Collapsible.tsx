"use client";
import { useState } from "react";

/** A card that opens on a click. Its children are only mounted while it is open, so a map inside measures a real
 * size when it starts instead of a hidden one. */
export default function Collapsible({ summary, children, open: initial = false }: { summary: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="rounded-lg border border-line bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm">
        <span>{summary}</span>
        <span className="text-muted shrink-0">{open ? "Hide ↑" : "Show ↓"}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
