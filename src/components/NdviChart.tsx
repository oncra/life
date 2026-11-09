import { seasonSpan } from "@/lib/readings";

export interface Pt { date: string; ndvi: number }
/** A season as the productivity reading counts it: its value and its first and last day (ms, UTC). */
export interface SeasonMark { year: number; mean: number; from: number; to: number }
/** The last counted season's reference: the median of the up to three seasons before it (content/spec.md 3.1). */
export interface Reference { from: number; to: number; value: number }

const INK = "#1d3a24";

// One dot per clear day. The trend line is each counted season's value, level across its shaded band and joined to the
// next, so the chart shows the very numbers the productivity reading compares; the grey band on the last season is its
// reference ±0.03, the band in which the reading says holding.
export default function NdviChart({ points, lat = 52, seasons = [], reference = null, width = 900, height = 260 }: {
  points: Pt[]; lat?: number; seasons?: SeasonMark[]; reference?: Reference | null; width?: number; height?: number;
}) {
  if (points.length === 0) return <div className="text-sm text-muted">No satellite observations yet. The backfill runs in the background; come back in a few minutes.</div>;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const xs = points.map((p) => new Date(p.date).getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = (t: number) => pad.l + ((Math.min(x1, Math.max(x0, t)) - x0) / Math.max(1, x1 - x0)) * (width - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v + 0.2) / 1.2) * (height - pad.t - pad.b);
  const years: number[] = [];
  for (let y = new Date(x0).getUTCFullYear(); y <= new Date(x1).getUTCFullYear(); y++) years.push(y);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(new Date(p.date).getTime()).toFixed(1)},${sy(p.ndvi).toFixed(1)}`).join(" ");
  const marks = seasons.filter((s) => s.to >= x0 && s.from <= x1).map((s) => ({ ...s, a: sx(s.from), b: sx(s.to), y: sy(s.mean) }));
  const trend = marks.map((m, i) => `${i === 0 ? "M" : "L"}${m.a.toFixed(1)},${m.y.toFixed(1)} L${m.b.toFixed(1)},${m.y.toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`NDVI time series${marks.length ? `, season values ${marks.map((m) => `${m.year} ${m.mean.toFixed(2)}`).join(", ")}` : ""}`}>
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={sy(v)} y2={sy(v)} stroke="#e4e2d9" />
            <text x={pad.l - 6} y={sy(v) + 4} fontSize="10" textAnchor="end" fill="#6b7268">{v.toFixed(1)}</text>
          </g>
        ))}
        {years.map((y) => {
          const t = Date.UTC(y, 0, 1);
          if (t < x0 || t > x1) return null;
          return (
            <g key={y}>
              <line x1={sx(t)} x2={sx(t)} y1={pad.t} y2={height - pad.b} stroke="#e4e2d9" strokeDasharray="2 3" />
              <text x={sx(t) + 3} y={height - 10} fontSize="10" fill="#6b7268">{y}</text>
            </g>
          );
        })}
        {[...years, years[years.length - 1] + 1].map((y) => {
          const [a, b] = seasonSpan(lat, y);
          if (b < x0 || a > x1) return null;
          return <rect key={`s${y}`} x={sx(a)} width={Math.max(0, sx(b) - sx(a))} y={pad.t} height={height - pad.t - pad.b} fill="#2f6b3a" opacity="0.05" />;
        })}
        {reference && reference.to >= x0 && reference.from <= x1 && (
          <g>
            <rect x={sx(reference.from)} width={Math.max(0, sx(reference.to) - sx(reference.from))} y={sy(reference.value + 0.03)} height={sy(reference.value - 0.03) - sy(reference.value + 0.03)} fill="#6b7268" opacity="0.25" />
            {[0.03, -0.03].map((d) => <line key={d} x1={sx(reference.from)} x2={sx(reference.to)} y1={sy(reference.value + d)} y2={sy(reference.value + d)} stroke="#6b7268" strokeDasharray="3 2" />)}
          </g>
        )}
        <path d={path} fill="none" stroke="#2f6b3a" strokeWidth="1" opacity="0.35" />
        {points.map((p, i) => <circle key={i} cx={sx(new Date(p.date).getTime())} cy={sy(p.ndvi)} r="2" fill="#2f6b3a" opacity="0.75" />)}
        {marks.length > 0 && <path d={trend} fill="none" stroke={INK} strokeWidth="1.25" opacity="0.6" />}
        {marks.map((m) => <line key={`m${m.year}`} x1={m.a} x2={m.b} y1={m.y} y2={m.y} stroke={INK} strokeWidth="3" strokeLinecap="round" />)}
        {marks.map((m) => (
          <text key={`l${m.year}`} x={(m.a + m.b) / 2} y={m.y - 7} fontSize="10" fontWeight="600" textAnchor="middle" fill={INK} stroke="#fff" strokeWidth="3" paintOrder="stroke">{m.mean.toFixed(2)}</text>
        ))}
      </svg>
      {marks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[3px] w-5 rounded" style={{ background: INK }} />season value, the number the productivity reading compares</span>
          {reference && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 bg-[#6b7268]/20 border-y border-dashed border-[#6b7268]" />last season&apos;s reference: median of the three before, ±0.03 (inside it the reading says holding)</span>}
        </div>
      )}
    </div>
  );
}
