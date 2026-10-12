"use client";
import { useState } from "react";
import { dayLabel, dayStart, dayStarts, fmtTime, wall } from "@/lib/clock";
import type { LifeIndexOut } from "@/lib/life-index";
import { useWidth } from "./useWidth";

const VERDICT_FILL: Record<string, string> = { thriving: "#2f6b3a", holding: "#8a9a2b", declining: "#b3452b", insufficient: "#e6e4da" };
const VERDICT_TEXT: Record<string, string> = { thriving: "#ffffff", holding: "#ffffff", declining: "#ffffff", insufficient: "#5b6157" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Tick = { t: number; label: string; major: boolean };
/** Years for a long span, months for a medium one, days for a short one. */
function indexTicks(from: number, to: number, zone: string): Tick[] {
  const span = to - from;
  const out: Tick[] = [];
  if (span > 400 * 864e5) {
    for (let y = new Date(from).getUTCFullYear(); y <= new Date(to).getUTCFullYear(); y++) {
      const t = dayStart(Date.UTC(y, 0, 1, 12), zone);
      if (t >= from && t <= to) out.push({ t, label: String(y), major: true });
    }
    return out;
  }
  if (span > 45 * 864e5) {
    const w = wall(from, zone);
    for (let i = 0; i < 30; i++) {
      const t = dayStart(Date.UTC(w.y, w.mo - 1 + i, 1, 12), zone);
      if (t > to) break;
      if (t >= from) { const ww = wall(t, zone); out.push({ t, label: ww.mo === 1 ? `${MON[0]} ${ww.y}` : MON[ww.mo - 1], major: ww.mo === 1 }); }
    }
    return out;
  }
  const days = dayStarts(from, to, zone).filter((t) => t >= from);
  const every = days.length > 16 ? 2 : 1;
  return days.filter((_, i) => i % every === 0).map((t) => ({ t, label: dayLabel(t, zone), major: true }));
}

/** The verdict over time above the three streams it is read from, on one time axis. Nothing is summed: the band is
 * the weakest of the seven readings per quarter, and a lane with no data says so instead of drawing something. */
export default function LifeIndexChart({ data }: { data: LifeIndexOut }) {
  const { ref, w } = useWidth();
  const [hx, setHx] = useState<number | null>(null);
  const { from, to, zone } = data;
  const pad = { l: 40, r: 40 };
  const inner = w - pad.l - pad.r;
  const sx = (t: number) => pad.l + ((t - from) / Math.max(1, to - from)) * inner;
  // rows: verdict band, satellite, sound, soil, axis
  const band = { y: 22, h: 18 };
  const lanes = { sat: { y: 62, h: 88 }, sound: { y: 174, h: 64 }, soil: { y: 262, h: 84 } };
  const height = 376;
  const ticks = indexTicks(from, to, zone);
  const labelEvery = Math.max(1, Math.ceil(ticks.length / Math.max(1, Math.floor(inner / 64))));
  const dayW = Math.max(1, inner / Math.max(1, (to - from) / 864e5));

  // satellite: 0..1
  const satY = (v: number) => lanes.sat.y + (1 - Math.max(0, Math.min(1, v))) * lanes.sat.h;
  let satPath = "", prev: number | null = null;
  for (const [t, v] of data.sat) { satPath += `${prev === null || t - prev > 40 * 864e5 ? "M" : "L"}${sx(t).toFixed(1)},${satY(v).toFixed(1)} `; prev = t; }
  // sound: species per day
  const soundMax = Math.max(5, ...data.sound.map((d) => d.species));
  const soundY = (n: number) => lanes.sound.y + (1 - n / soundMax) * lanes.sound.h;
  // soil: moisture 0..100 as an area, temperature on its own scale
  const temps = data.soil.map((d) => d.tempC).filter((v): v is number => v !== null);
  const tLo = Math.min(0, ...temps), tHi = Math.max(25, ...temps);
  const vwcY = (v: number) => lanes.soil.y + (1 - Math.max(0, Math.min(100, v)) / 100) * lanes.soil.h;
  const tempY = (v: number) => lanes.soil.y + (1 - (v - tLo) / (tHi - tLo)) * lanes.soil.h;
  const soilSorted = [...data.soil].sort((a, b) => a.t - b.t);
  let vwcArea = "", tempPath = "";
  prev = null;
  for (const d of soilSorted) {
    if (d.vwc !== null) { vwcArea += `${prev === null || d.t - prev > 3 * 864e5 ? `M${sx(d.t).toFixed(1)},${(lanes.soil.y + lanes.soil.h).toFixed(1)} L` : "L"}${sx(d.t).toFixed(1)},${vwcY(d.vwc).toFixed(1)} `; }
    prev = d.t;
  }
  prev = null;
  for (const d of soilSorted) {
    if (d.tempC !== null) { tempPath += `${prev === null || d.t - prev > 3 * 864e5 ? "M" : "L"}${sx(d.t).toFixed(1)},${tempY(d.tempC).toFixed(1)} `; }
    prev = d.t;
  }
  if (vwcArea) { const last = soilSorted.filter((d) => d.vwc !== null).pop()!; vwcArea += `L${sx(last.t).toFixed(1)},${(lanes.soil.y + lanes.soil.h).toFixed(1)} Z`; }

  // hover
  const ht = hx === null ? null : from + ((hx - pad.l) / inner) * (to - from);
  const hDay = ht === null ? null : dayStart(ht, zone);
  const hSat = ht === null ? null : data.sat.reduce<[number, number] | null>((a, p) => (Math.abs(p[0] - ht) <= 12 * 864e5 && (!a || Math.abs(p[0] - ht) < Math.abs(a[0] - ht)) ? p : a), null);
  const hSound = hDay === null ? null : data.sound.find((d) => d.t === hDay) ?? null;
  const hSoil = hDay === null ? null : data.soil.find((d) => d.t === hDay) ?? null;
  const hPeriod = ht === null ? null : data.periods.find((p) => ht >= p.from && ht < p.to) ?? null;
  const readout = ht === null ? "" : [
    dayLabel(ht, zone),
    hPeriod ? `verdict ${hPeriod.verdict}` : "verdict not computed",
    hSat ? `greenness ${hSat[1].toFixed(2)} (${fmtTime(hSat[0], zone).slice(0, 10)})` : "no clear scene within 12 days",
    hSound ? `${hSound.species} species, ${hSound.detections} detections` : data.sound.length ? "nothing heard" : "no recorder",
    hSoil && hSoil.vwc !== null ? `soil ${hSoil.vwc.toFixed(0)}% · ${hSoil.tempC?.toFixed(1) ?? "?"} °C · breathing index ${hSoil.activity?.toFixed(2) ?? "?"}` : data.soil.length ? "no soil reading" : "no probe",
  ].join(" · ");

  const laneHead = (lane: { y: number; h: number }, title: string, sub: string) => (
    <g>
      <text x={pad.l} y={lane.y - 7} fontSize="11" fontWeight="600" fill="#1b1f1a">{title}</text>
      <text x={pad.l + title.length * 6.6 + 8} y={lane.y - 7} fontSize="10.5" fill="#6b7268">{sub}</text>
      <line x1={pad.l} x2={w - pad.r} y1={lane.y + lane.h} y2={lane.y + lane.h} stroke="#e4e2d9" />
    </g>
  );
  const empty = (lane: { y: number; h: number }, text: string) => <text x={pad.l + inner / 2} y={lane.y + lane.h / 2 + 4} fontSize="11" textAnchor="middle" fill="#6b7268">{text}</text>;

  return (
    <div ref={ref} className="select-none">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="block max-w-full" role="img" aria-label="Life index: the verdict over time and the satellite, sound and soil streams" style={{ touchAction: "pan-y" }}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * w; setHx(x < pad.l || x > w - pad.r ? null : x); }}
        onPointerLeave={() => setHx(null)}>
        {/* growing seasons, through every lane */}
        {data.seasons.map(([a, b], i) => <rect key={i} x={sx(a)} width={Math.max(0, sx(b) - sx(a))} y={lanes.sat.y} height={lanes.soil.y + lanes.soil.h - lanes.sat.y} fill="#2f6b3a" opacity="0.05" />)}
        {/* time ticks */}
        {ticks.map((k, i) => (
          <g key={i}>
            <line x1={sx(k.t)} x2={sx(k.t)} y1={band.y} y2={lanes.soil.y + lanes.soil.h} stroke="#e4e2d9" strokeDasharray={k.major ? undefined : "2 3"} />
            {i % labelEvery === 0 && <text x={sx(k.t) + 3} y={height - 8} fontSize="11" fill="#6b7268">{k.label}</text>}
          </g>
        ))}

        {/* verdict band */}
        <text x={pad.l} y={band.y - 7} fontSize="11" fontWeight="600" fill="#1b1f1a">Verdict</text>
        <text x={pad.l + 52} y={band.y - 7} fontSize="10.5" fill="#6b7268">the weakest of seven readings, per quarter</text>
        <rect x={pad.l} y={band.y} width={inner} height={band.h} fill="#f4f3ec" />
        {(() => { const first = data.periods.find((p) => p.to > from); const x1 = first ? Math.min(sx(first.from), w - pad.r) : w - pad.r; return x1 - pad.l > 150 ? <text x={pad.l + 6} y={band.y + 13} fontSize="11" fill="#8a9086">no readings yet: the place was registered later</text> : null; })()}
        {data.periods.map((p) => {
          const x0 = Math.max(sx(p.from), pad.l), x1 = Math.min(sx(p.to), w - pad.r);
          if (x1 <= x0) return null;
          const label = x1 - x0 > 110 ? `${p.period} · ${p.verdict}` : x1 - x0 > 60 ? p.verdict : "";
          return (
            <g key={p.period}>
              <rect x={x0} y={band.y} width={x1 - x0} height={band.h} fill={VERDICT_FILL[p.verdict]} />
              {label && <text x={x0 + 6} y={band.y + 13} fontSize="11" fill={VERDICT_TEXT[p.verdict]}>{label}</text>}
            </g>
          );
        })}

        {/* satellite */}
        {laneHead(lanes.sat, "Satellite", "greenness (NDVI) per clear Sentinel-2 scene; shaded: growing season")}
        {[0, 0.5, 1].map((v) => <text key={v} x={pad.l - 5} y={satY(v) + 4} fontSize="10" textAnchor="end" fill="#6b7268">{v.toFixed(1)}</text>)}
        <path d={satPath} fill="none" stroke="#2f6b3a" strokeWidth="1" opacity="0.5" />
        {data.sat.map((p, i) => <circle key={i} cx={sx(p[0])} cy={satY(p[1])} r={data.sat.length > 150 ? 1.6 : 2.2} fill="#2f6b3a" />)}
        {data.sat.length === 0 && empty(lanes.sat, "no clear scene in this span")}

        {/* sound */}
        {laneHead(lanes.sound, "Sound", "species heard per day (70% sure or more), the recorder in the box")}
        {[0, soundMax].map((v) => <text key={v} x={pad.l - 5} y={soundY(v) + 4} fontSize="10" textAnchor="end" fill="#6b7268">{v}</text>)}
        {data.sound.map((d) => <rect key={d.t} x={sx(d.t) + 0.5} y={soundY(d.species)} width={Math.max(1.5, dayW - 1)} height={Math.max(0, lanes.sound.y + lanes.sound.h - soundY(d.species))} fill="#2f6b3a" opacity="0.8" />)}
        {data.sound.length === 0 && empty(lanes.sound, data.nodeSince ? "nothing heard in this span" : "no recorder yet")}

        {/* soil */}
        {laneHead(lanes.soil, "Soil", `moisture (area, %) and temperature (line, °C) at ${data.soilDepthCm ?? "?"} cm, daily means`)}
        {[0, 50, 100].map((v) => <text key={v} x={pad.l - 5} y={vwcY(v) + 4} fontSize="10" textAnchor="end" fill="#3b82c4">{v}</text>)}
        {[tLo, tHi].map((v) => <text key={v} x={w - pad.r + 5} y={tempY(v) + 4} fontSize="10" fill="#d9822b">{v.toFixed(0)}°</text>)}
        <path d={vwcArea} fill="#3b82c4" opacity="0.2" />
        <path d={tempPath} fill="none" stroke="#d9822b" strokeWidth="1.5" strokeLinejoin="round" />
        {data.soil.length === 0 && empty(lanes.soil, data.nodeSince ? "no soil reading in this span" : "no probe yet")}

        {/* the node's arrival, and now */}
        {data.nodeSince !== null && data.nodeSince >= from && data.nodeSince <= to && (
          <g>
            <line x1={sx(data.nodeSince)} x2={sx(data.nodeSince)} y1={band.y + band.h} y2={lanes.soil.y + lanes.soil.h} stroke="#1b1f1a" strokeDasharray="3 3" opacity="0.5" />
            <rect x={sx(data.nodeSince) - 96} y={lanes.sat.y + 2} width={92} height={14} fill="#ffffff" opacity="0.85" />
            <text x={sx(data.nodeSince) - 6} y={lanes.sat.y + 13} fontSize="10.5" textAnchor="end" fill="#1b1f1a">the node arrived</text>
          </g>
        )}
        <line x1={sx(to)} x2={sx(to)} y1={band.y} y2={lanes.soil.y + lanes.soil.h} stroke="#1b1f1a" opacity="0.35" />
        <text x={sx(to) + 3} y={band.y + 13} fontSize="10" fill="#6b7268">now</text>

        {/* hover */}
        {ht !== null && (
          <g>
            <line x1={sx(ht)} x2={sx(ht)} y1={band.y} y2={lanes.soil.y + lanes.soil.h} stroke="#1b1f1a" opacity="0.4" />
            {hSat && <circle cx={sx(hSat[0])} cy={satY(hSat[1])} r="4" fill="#fff" stroke="#2f6b3a" strokeWidth="2" />}
            {hSoil && hSoil.tempC !== null && <circle cx={sx(hSoil.t)} cy={tempY(hSoil.tempC)} r="3.5" fill="#fff" stroke="#d9822b" strokeWidth="2" />}
            <rect x={pad.l} y={height - 24} width={inner} height={16} fill="#fbfaf6" opacity="0.95" />
            <text x={pad.l + 2} y={height - 12} fontSize="11" fill="#1b1f1a">{readout}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
