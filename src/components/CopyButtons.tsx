"use client";
import { useEffect } from "react";

// Wires every `.ai-copy` button rendered from markdown: copies the text of the box it sits on.
export function CopyButtons() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const b = (e.target as HTMLElement).closest?.(".ai-copy") as HTMLButtonElement | null;
      if (!b) return;
      const pre = b.closest(".ai-box")?.querySelector("pre");
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent ?? "").then(() => {
        b.textContent = "Copied";
        setTimeout(() => { b.textContent = "Copy"; }, 1500);
      });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
