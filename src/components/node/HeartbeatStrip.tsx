"use client";
import { useState } from "react";
import { fmtTime, spanLabel, timeTicks } from "@/lib/clock";
import type { Beat, Gap } from "@/lib/node";
import { useWidth } from "./useWidth";

const EVENT_LABEL: Record<string, string> = { hourly: "regular post", boot: "started", shutdown: "switching off", manual: "sent by hand", alarm: "alarm" };

/** Every post the node made, as a tick on a timeline; a silence longer than the posting rhythm is a band, blue when
 * the box had said it was switching off, red when it just stopped. */
export default function HeartbeatStrip({ beats, gaps, from, to, zone, night = [], now }: { beats: Beat[]; gaps: Gap[]; from: number; to: number; zone: string; night?: [number, number][]; now: number }) {
  const { ref, w } = useWidth();
  const [hx, setHx] = useState<number | null>(null);
  const height = 92;
  const pad = { l: 8, r: 8, t: 24, b: 22 };
  const inner = w - pad.l - pad.r;
  const base = height - pad.b - 8;
  const sx = (t: number) => pad.l + ((t - from) / Math.max(1, to - from)) * inner;
  const ticks = timeTicks(from, to, zone);
  const labelEvery = Math.max(1, Math.ceil(ticks.length / Math.max(1, Math.floor(inner / 80))));
  const ht = hx === null ? null : from + ((hx - pad.l) / inner) * (to - from);
  const near = ht === null ? null : beats.reduce<Beat | null>((a, b) => (!a || Math.abs(b.t - ht) < Math.abs(a.t - ht) ? b : a), null);
  const nearOk = near && ht !== null && Math.abs(near.t - ht) < (to - from) / 40 ? near : null;
  const overGap = ht === null ? null : gaps.find((g) => ht >= g.from && ht <= g.to) ?? null;
  const starts = beats.filter((b) => b.start).length;
  const offs = beats.filter((b) => b.event === "shutdown").length;
  const longest = gaps.reduce((a, g) => Math.max(a, g.to - g.from), 0);
  const missed = gaps.filter((g) => g.kind === "missed").length;

  return (
    <div ref={ref} className="select-none">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="block max-w-full" role="img" aria-label="Heartbeats over time" style={{ touchAction: "pan-y" }}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * w; setHx(x < pad.l || x > w - pad.r ? null : x); }}
        onPointerLeave={() => setHx(null)}>
        {night.map(([a, b], i) => <rect key={i} x={sx(Math.max(a, from))} width={Math.max(0, sx(Math.min(b, to)) - sx(Math.max(a, from)))} y={pad.t} height={base - pad.t + 8} fill="#1b1f1a" opacity="0.05" />)}
        {gaps.map((g, i) => (
          <g key={i}>
            <rect x={sx(g.from)} width={Math.max(1, sx(g.to) - sx(g.from))} y={pad.t + 6} height={base - pad.t - 6} fill={g.kind === "asleep" ? "#9fb3c8" : "#d9604a"} opacity={g.kind === "asleep" ? 0.25 : 0.28} />
            {sx(g.to) - sx(g.from) > 54 && <text x={(sx(g.from) + sx(g.to)) / 2} y={base - 10} fontSize="10" textAnchor="middle" fill={g.kind === "asleep" ? "#3b5a7a" : "#8a2e1c"}>{g.kind === "asleep" ? "asleep" : g.open ? "silent" : "missed"} {spanLabel(g.to - g.from)}</text>}
          </g>
        ))}
        <line x1={pad.l} x2={w - pad.r} y1={base} y2={base} stroke="#6b7268" strokeWidth="1" />
        {ticks.map((k, i) => (
          <g key={i}>
            <line x1={sx(k.t)} x2={sx(k.t)} y1={base} y2={base + 5} stroke="#6b7268" />
            {i % labelEvery === 0 && <text x={sx(k.t) + (w - sx(k.t) < 70 ? -3 : 3)} y={height - 7} fontSize="11" fill="#6b7268" textAnchor={w - sx(k.t) < 70 ? "end" : "start"}>{k.label}</text>}
          </g>
        ))}
        {beats.map((b, i) => {
          const x = sx(b.t);
          if (b.event === "shutdown") return <rect key={i} x={x - 3} y={base - 14} width="6" height="6" fill="#1b1f1a" />;
          if (b.start) return <path key={i} d={`M${x - 4},${base - 8} L${x + 4},${base - 8} L${x},${base - 18} Z`} fill="#2f6b3a" />;
          return <line key={i} x1={x} x2={x} y1={base - 16} y2={base} stroke="#2f6b3a" strokeWidth="2" strokeLinecap="round" />;
        })}
        {beats.length === 0 && <text x={pad.l + inner / 2} y={base - 22} fontSize="12" textAnchor="middle" fill="#6b7268">No heartbeats in this range.</text>}
        {ht !== null && (
          <g>
            <line x1={sx(nearOk ? nearOk.t : ht)} x2={sx(nearOk ? nearOk.t : ht)} y1={pad.t} y2={base} stroke="#1b1f1a" opacity="0.35" />
            <text x={pad.l} y={14} fontSize="12" fill="#1b1f1a">
              {nearOk
                ? `${fmtTime(nearOk.t, zone)} · ${nearOk.start ? `first post after a start${nearOk.wake ? ` (${nearOk.wake})` : ""}` : EVENT_LABEL[nearOk.event ?? ""] ?? nearOk.event ?? "post"}${nearOk.battV !== null ? ` · ${nearOk.battV.toFixed(2)} V` : ""}${nearOk.unsent ? ` · ${nearOk.unsent} unsent` : ""}`
                : overGap
                  ? `${fmtTime(overGap.from, zone)} to ${overGap.open ? "now" : fmtTime(overGap.to, zone)}: ${overGap.kind === "asleep" ? "asleep after a shutdown" : "nothing heard"}, ${spanLabel(overGap.to - overGap.from)}`
                  : fmtTime(ht, zone)}
            </text>
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><span className="inline-block w-0.5 h-3 bg-accent align-middle mr-1.5" />post</span>
        <span><span className="inline-block w-0 h-0 align-middle mr-1.5" style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "9px solid #2f6b3a" }} />first post after a start</span>
        <span><span className="inline-block w-2 h-2 bg-foreground align-middle mr-1.5" />switching off</span>
        <span><span className="inline-block w-3 h-3 align-middle mr-1.5" style={{ background: "rgba(159,179,200,.5)" }} />asleep</span>
        <span><span className="inline-block w-3 h-3 align-middle mr-1.5" style={{ background: "rgba(217,96,74,.5)" }} />silent</span>
        <span className="ml-auto">{beats.length} posts · {starts} start{starts === 1 ? "" : "s"} · {offs} shutdown{offs === 1 ? "" : "s"} · {missed ? `${missed} unplanned silence${missed === 1 ? "" : "s"}, longest ${spanLabel(longest)}` : longest ? `longest sleep ${spanLabel(longest)}` : "no silences"}{now - to > 60000 ? "" : ""}</span>
      </div>
    </div>
  );
}
