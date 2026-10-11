"use client";
import { useEffect, useRef, useState } from "react";

/** The width of a wrapper element, so a chart can draw at the size it is shown at and its text stays readable on a
 * phone. The server and the first client render use `initial`; the real width arrives after mount. */
export function useWidth(initial = 900) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}
