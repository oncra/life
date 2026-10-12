"use client";
import { useEffect, useRef } from "react";
import { GLOBE_DOTS_B64 } from "@/lib/globe-dots";
import { signalStatus, type NodeSignal } from "@/lib/node-signal";

/** Where the oracle runs: Nuremberg. On the globe every post travels from its node to here. */
export const ORACLE = { lat: 49.45, lon: 11.08, name: "Life Oracle" };

// The site's own colours, on its own off-white: no black globe. Land in accent green, nodes glowing in the
// status colour, pulses in a darker green that reads on a light ground.
const COLOR = { live: "#2f6b3a", stale: "#b7791f", silent: "#7a7a72" } as const;
const INK = "#1b1f1a";
const PULSE = "#1f5a2c";
const RAD = Math.PI / 180;

type Vec = [number, number, number];
/** Unit vector of a point on the sphere: lon 0 / lat 0 faces the viewer, east is right, north is up. */
function vec(lat: number, lon: number): Vec {
  const c = Math.cos(lat * RAD);
  return [c * Math.sin(lon * RAD), Math.sin(lat * RAD), c * Math.cos(lon * RAD)];
}
let dotsCache: Float32Array | null = null;
function landDots(): Float32Array {
  if (dotsCache) return dotsCache;
  const bin = atob(GLOBE_DOTS_B64);
  const n = bin.length / 4;
  const dv = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) dv.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = vec(dv.getInt16(i * 4, true) / 10, dv.getInt16(i * 4 + 2, true) / 10);
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return (dotsCache = out);
}

/** The Earth as rows of dots, the nodes glowing on it, and their posts as pulses of light travelling to the oracle.
 * Drawn on a canvas, nothing to load. Drag to turn it; it breathes around the focus by itself. */
export default function Globe({ signals, focus, height = 400, now }: { signals: NodeSignal[]; focus?: { lat: number; lon: number; name: string } | null; height?: number; now?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef({ on: false, x: 0, y: 0, lon: 0, lat: 0 });

  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    const maybe = cv.getContext("2d");
    if (!maybe) return;
    const ctx: CanvasRenderingContext2D = maybe;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dots = landDots();
    const t0 = performance.now();
    const nowMs = now ?? Date.now();
    const nodes = signals.map((s) => ({ s, v: vec(s.lat, s.lon), status: signalStatus(s.heardAt, nowMs), phase: hash(s.slug) }));
    const oracle = vec(ORACLE.lat, ORACLE.lon);
    const home = focus ?? (nodes.length ? { lat: nodes[0].s.lat, lon: nodes[0].s.lon, name: nodes[0].s.name } : { lat: 45, lon: 10, name: "" });
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = el.clientWidth; h = height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    };
    size();
    const ro = new ResizeObserver(() => { size(); if (reduced) draw(performance.now()); });
    ro.observe(el);

    function draw(ts: number) {
      const t = ts - t0;
      const R = Math.min(w, h) * 0.43, cx = w / 2, cy = h / 2;
      const breathe = reduced ? 0 : 16 * Math.sin(t / 14000);
      const lon0 = home.lon + breathe + drag.current.lon;
      const lat0 = Math.max(-60, Math.min(60, home.lat * 0.85 + drag.current.lat));
      const a = -lon0 * RAD, b = lat0 * RAD;
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      // rotate so that (lat0, lon0) faces the viewer; returns screen x, y and depth (1 = facing, <0 = behind)
      const proj = (x: number, y: number, z: number, r = R): [number, number, number] => {
        const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
        const y2 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
        return [cx + r * x1, cy - r * y2, z2];
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // atmosphere and the disc
      const halo = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.18);
      halo.addColorStop(0, "rgba(47,107,58,0.16)"); halo.addColorStop(1, "rgba(47,107,58,0)");
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2); ctx.fill();
      const disc = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
      disc.addColorStop(0, "#f4f6f0"); disc.addColorStop(1, "#dde5d8");
      ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(47,107,58,0.4)"; ctx.lineWidth = 1; ctx.stroke();

      // graticule, every 30 degrees
      ctx.strokeStyle = "rgba(47,107,58,0.14)"; ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let lon = -180; lon < 180; lon += 30) polyline(ctx, Array.from({ length: 61 }, (_, i) => vec(-90 + i * 3, lon)), proj);
      for (let lat = -60; lat <= 60; lat += 30) polyline(ctx, Array.from({ length: 121 }, (_, i) => vec(lat, -180 + i * 3)), proj);
      ctx.stroke();

      // land: four brightness buckets by how much a dot faces the viewer
      const buckets: Path2D[] = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const s = Math.max(1, R / 170);
      for (let i = 0; i < dots.length; i += 3) {
        const [px, py, d] = proj(dots[i], dots[i + 1], dots[i + 2]);
        if (d <= 0.02) continue;
        buckets[Math.min(3, Math.floor(d * 4))].rect(px - s / 2, py - s / 2, s, s);
      }
      [0.2, 0.38, 0.62, 0.9].forEach((alpha, i) => { ctx.fillStyle = `rgba(47,107,58,${alpha})`; ctx.fill(buckets[i]); });

      // the oracle
      const [ox, oy, od] = proj(oracle[0], oracle[1], oracle[2]);
      if (od > 0) {
        ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
        ctx.strokeRect(ox - 3.5, oy - 3.5, 7, 7);
        label(ctx, ORACLE.name, ox, oy, "#6b7268", 11, true);
      }

      // arcs and the pulses travelling along them
      for (const n of nodes) {
        if (n.status === "silent") continue;
        const pts = arc(n.v, oracle, 48);
        ctx.strokeStyle = n.status === "live" ? "rgba(47,107,58,0.45)" : "rgba(183,121,31,0.45)"; ctx.lineWidth = 1;
        ctx.beginPath(); polyline(ctx, pts.map((p) => p.v), proj, pts.map((p) => p.r)); ctx.stroke();
        if (reduced) continue;
        const period = n.status === "live" ? 3200 : 9000;
        const u = ((t / period) + n.phase) % 1;
        for (let k = 0; k < 6; k++) {
          const uu = u - k * 0.012;
          if (uu < 0) break;
          const p = sample(pts, uu);
          const [px, py, d] = proj(p.v[0], p.v[1], p.v[2], R * p.r);
          if (d < -0.05) continue;
          ctx.fillStyle = hexA(PULSE, 0.95 - k * 0.16);
          ctx.beginPath(); ctx.arc(px, py, k === 0 ? 2.8 : 1.7, 0, Math.PI * 2); ctx.fill();
        }
      }

      // the nodes
      for (const n of nodes) {
        const [px, py, d] = proj(n.v[0], n.v[1], n.v[2]);
        if (d <= 0) continue;
        const col = COLOR[n.status];
        const isFocus = focus ? n.s.slug === focusSlug(focus, nodes) : nodes.length === 1;
        const g = ctx.createRadialGradient(px, py, 0, px, py, isFocus ? 18 : 12);
        g.addColorStop(0, hexA(col, 0.4)); g.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, isFocus ? 18 : 12, 0, Math.PI * 2); ctx.fill();
        if (!reduced && n.status !== "silent") {
          for (let k = 0; k < 3; k++) {
            const ph = ((t / (n.status === "live" ? 2600 : 6000)) + k / 3 + n.phase) % 1;
            ctx.strokeStyle = hexA(col, (1 - ph) * 0.7); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(px, py, 4 + ph * (isFocus ? 26 : 16), 0, Math.PI * 2); ctx.stroke();
          }
        }
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(px, py, isFocus ? 4 : 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, isFocus ? 2.6 : 1.8, 0, Math.PI * 2); ctx.fill();
        if (isFocus || nodes.length <= 6) label(ctx, n.s.name, px, py, isFocus ? INK : "#6b7268", isFocus ? 13 : 11);
      }
    }

    function loop(ts: number) {
      if (ts - last >= 1000 / 40) { last = ts; draw(ts); }
      raf = requestAnimationFrame(loop);
    }
    if (reduced) draw(performance.now()); else raf = requestAnimationFrame(loop);

    const down = (e: PointerEvent) => { drag.current.on = true; drag.current.x = e.clientX; drag.current.y = e.clientY; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag.current.on) return;
      // the ground follows the finger: pulling right turns the globe so that what was under the finger moves right
      drag.current.lon -= (e.clientX - drag.current.x) * 0.35; drag.current.lat += (e.clientY - drag.current.y) * 0.35;
      drag.current.x = e.clientX; drag.current.y = e.clientY;
      if (reduced) draw(performance.now());
    };
    const up = () => { drag.current.on = false; };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); cv.removeEventListener("pointercancel", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrap} className="w-full select-none">
      <canvas ref={canvas} className="block w-full cursor-grab active:cursor-grabbing" style={{ height, touchAction: "pan-y" }} role="img" aria-label="A globe with every Life Node as a glowing point, their posts travelling to the oracle" />
    </div>
  );
}

function focusSlug(focus: { lat: number; lon: number }, nodes: { s: NodeSignal }[]): string | null {
  let best: { slug: string; d: number } | null = null;
  for (const n of nodes) {
    const d = Math.hypot(n.s.lat - focus.lat, n.s.lon - focus.lon);
    if (!best || d < best.d) best = { slug: n.s.slug, d };
  }
  return best && best.d < 0.5 ? best.slug : null;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** A small white plate with text to the right of a point: above it, or below it for the oracle so the two never overlap. */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, px: number, below = false) {
  ctx.font = `${px}px ui-sans-serif, system-ui, sans-serif`;
  const wdt = ctx.measureText(text).width;
  const top = below ? y + 6 : y - px - 2;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillRect(x + 8, top, wdt + 8, px + 6);
  ctx.strokeStyle = "#e4e2d9"; ctx.lineWidth = 1;
  ctx.strokeRect(x + 8.5, top + 0.5, wdt + 7, px + 5);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 12, top + px + 1);
}

/** Draws the visible pieces of a line through points on (or above) the sphere. */
function polyline(ctx: CanvasRenderingContext2D, pts: Vec[], proj: (x: number, y: number, z: number, r?: number) => [number, number, number], radii?: number[]) {
  let pen = false;
  for (let i = 0; i < pts.length; i++) {
    const r = radii ? radii[i] : undefined;
    const [x, y, d] = r === undefined ? proj(pts[i][0], pts[i][1], pts[i][2]) : proj(pts[i][0], pts[i][1], pts[i][2], r);
    if (d > 0) { if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } } else pen = false;
  }
}

/** A great-circle arc from a to b, lifted off the surface in the middle; `r` is the radius as a fraction of R. */
function arc(a: Vec, b: Vec, n: number): { v: Vec; r: number }[] {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const ang = Math.acos(dot);
  const lift = 0.04 + 0.16 * Math.min(1, ang / 0.8);
  const out: { v: Vec; r: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let v: Vec;
    if (ang < 1e-4) v = a;
    else {
      const s = Math.sin(ang), wa = Math.sin((1 - u) * ang) / s, wb = Math.sin(u * ang) / s;
      v = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
    }
    out.push({ v, r: 1 + lift * Math.sin(Math.PI * u) });
  }
  return out;
}

function sample(pts: { v: Vec; r: number }[], u: number): { v: Vec; r: number } {
  const i = Math.min(pts.length - 1, Math.max(0, Math.round(u * (pts.length - 1))));
  return pts[i];
}
