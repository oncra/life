"use client";
import { useState } from "react";
import { fmtTime, timeTicks } from "@/lib/clock";
import { useWidth } from "./useWidth";

export type Series = { name: string; color: string; points: [number, number][]; unit?: string; dash?: string };
export type Guide = { y: number; label: string; color?: string };

/** A line chart over time, drawn by hand. Nights are shaded, a line breaks where readings are further apart than
 * `gapMs`, and a pointer over the chart reads the nearest values. */
export default function SeriesChart({ series, from, to, zone, night = [], guides = [], height = 220, yMin, yMax, decimals = 1, gapMs = 3 * 3600e3, empty = "No readings in this range." }: {
  series: Series[]; from: number; to: number; zone: string; night?: [number, number][]; guides?: Guide[];
  height?: number; yMin?: number; yMax?: number; decimals?: number; gapMs?: number; empty?: string;
}) {
  const { ref, w } = useWidth();
  const [hx, setHx] = useState<number | null>(null);
  const pad = { l: 46, r: 14, t: 28, b: 26 };
  const inner = w - pad.l - pad.r;
  const values = series.flatMap((s) => s.points.filter((p) => p[0] >= from && p[0] <= to).map((p) => p[1]));
  const hasData = values.length > 0;
  let lo = Math.min(...(hasData ? values : [0]), ...guides.map((g) => g.y));
  let hi = Math.max(...(hasData ? values : [1]), ...guides.map((g) => g.y));
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.1;
  lo = yMin ?? lo - padY;
  hi = yMax ?? hi + padY;
  const sx = (t: number) => pad.l + ((t - from) / Math.max(1, to - from)) * inner;
  const sy = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const step = niceStep(hi - lo, 4);
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 && yTicks.length < 20; v += step) yTicks.push(+v.toFixed(6));
  const xTicks = timeTicks(from, to, zone);
  // a label every 80 px at most; the grid line stays for every tick
  const labelEvery = Math.max(1, Math.ceil(xTicks.length / Math.max(1, Math.floor(inner / 80))));
  const paths = series.map((s) => {
    let d = "", prev: number | null = null;
    for (const [t, v] of s.points) {
      if (t < from || t > to) continue;
      d += `${prev === null || t - prev > gapMs ? "M" : "L"}${sx(t).toFixed(1)},${sy(v).toFixed(1)} `;
      prev = t;
    }
    return d;
  });
  const ht = hx === null ? null : from + ((hx - pad.l) / inner) * (to - from);
  const near = ht === null ? [] : series.map((s) => nearest(s.points, ht, gapMs));
  const nearT = near.find((p) => p)?.[0] ?? ht;
  const fmt = (v: number) => v.toFixed(decimals);
  const latest = series.map((s) => { const inRange = s.points.filter((p) => p[0] >= from && p[0] <= to); return inRange.length ? inRange[inRange.length - 1] : null; });

  return (
    <div ref={ref} className="relative select-none">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="block max-w-full" role="img" aria-label={series.map((s) => s.name).join(", ")} style={{ touchAction: "pan-y" }}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * w; setHx(x < pad.l || x > w - pad.r ? null : x); }}
        onPointerLeave={() => setHx(null)}>
        {night.map(([a, b], i) => <rect key={i} x={sx(Math.max(a, from))} width={Math.max(0, sx(Math.min(b, to)) - sx(Math.max(a, from)))} y={pad.t} height={height - pad.t - pad.b} fill="#1b1f1a" opacity="0.05" />)}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} stroke="#e4e2d9" />
            <text x={pad.l - 6} y={sy(v) + 4} fontSize="11" textAnchor="end" fill="#6b7268">{fmt(v)}</text>
          </g>
        ))}
        {xTicks.map((k, i) => (
          <g key={i}>
            <line x1={sx(k.t)} x2={sx(k.t)} y1={pad.t} y2={height - pad.b} stroke="#e4e2d9" strokeDasharray={k.major ? undefined : "2 3"} />
            {i % labelEvery === 0 && <text x={sx(k.t) + (w - sx(k.t) < 70 ? -3 : 3)} y={height - 9} fontSize="11" fill="#6b7268" textAnchor={w - sx(k.t) < 70 ? "end" : "start"}>{k.label}</text>}
          </g>
        ))}
        {guides.map((g) => (
          <g key={g.label}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(g.y)} y2={sy(g.y)} stroke={g.color ?? "#b3452b"} strokeDasharray="5 4" opacity="0.6" />
            <text x={w - pad.r - 2} y={sy(g.y) - 4} fontSize="10" textAnchor="end" fill={g.color ?? "#b3452b"}>{g.label}</text>
          </g>
        ))}
        {series.map((s, i) => <path key={s.name} d={paths[i]} fill="none" stroke={s.color} strokeWidth="1.8" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />)}
        {series.map((s, i) => s.points.length <= 60 && s.points.filter((p) => p[0] >= from && p[0] <= to).map((p, j) => <circle key={`${i}-${j}`} cx={sx(p[0])} cy={sy(p[1])} r="2.4" fill={s.color} />))}
        {!hasData && <text x={pad.l + inner / 2} y={pad.t + (height - pad.t - pad.b) / 2} fontSize="12" textAnchor="middle" fill="#6b7268">{empty}</text>}
        {ht !== null && nearT !== null && (
          <g>
            <line x1={sx(nearT)} x2={sx(nearT)} y1={pad.t} y2={height - pad.b} stroke="#1b1f1a" opacity="0.35" />
            {near.map((p, i) => p && <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r="4" fill="#fff" stroke={series[i].color} strokeWidth="2" />)}
            <text x={pad.l} y={16} fontSize="12" fill="#1b1f1a">
              {fmtTime(nearT, zone)}{near.map((p, i) => p ? ` · ${series[i].name} ${fmt(p[1])}${series[i].unit ?? ""}` : "").join("")}
            </text>
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s, i) => (
          <span key={s.name}><span className="inline-block w-3 align-middle mr-1.5" style={{ borderTop: `3px ${s.dash ? "dashed" : "solid"} ${s.color}` }} />{s.name}{latest[i] ? <>: <span className="text-foreground">{fmt(latest[i]![1])}{s.unit ?? ""}</span></> : null}</span>
        ))}
      </div>
    </div>
  );
}

function niceStep(span: number, n: number): number {
  const raw = Math.max(1e-9, span / n);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** The point nearest to `t`, or null when the nearest one is more than `gapMs` away. Points are sorted by time. */
function nearest(points: [number, number][], t: number, gapMs: number): [number, number] | null {
  if (points.length === 0) return null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid][0] < t) lo = mid + 1; else hi = mid; }
  const cands = [points[lo], points[lo - 1]].filter(Boolean) as [number, number][];
  const best = cands.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
  return Math.abs(best[0] - t) <= gapMs ? best : null;
}
