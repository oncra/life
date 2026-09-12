export interface Pt { date: string; ndvi: number }
export default function NdviChart({ points, width = 900, height = 260 }: { points: Pt[]; width?: number; height?: number }) {
  if (points.length === 0) return <div className="text-sm text-muted">No satellite observations yet. The backfill runs in the background; come back in a few minutes.</div>;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const xs = points.map((p) => new Date(p.date).getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = (t: number) => pad.l + ((t - x0) / Math.max(1, x1 - x0)) * (width - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v + 0.2) / 1.2) * (height - pad.t - pad.b);
  const years: number[] = [];
  for (let y = new Date(x0).getUTCFullYear(); y <= new Date(x1).getUTCFullYear(); y++) years.push(y);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(new Date(p.date).getTime()).toFixed(1)},${sy(p.ndvi).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="NDVI time series">
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
      {years.map((y) => {
        const a = Date.UTC(y, 3, 1), b = Date.UTC(y, 8, 30);
        if (b < x0 || a > x1) return null;
        return <rect key={`s${y}`} x={sx(Math.max(a, x0))} width={Math.max(0, sx(Math.min(b, x1)) - sx(Math.max(a, x0)))} y={pad.t} height={height - pad.t - pad.b} fill="#2f6b3a" opacity="0.05" />;
      })}
      <path d={path} fill="none" stroke="#2f6b3a" strokeWidth="1.2" opacity="0.7" />
      {points.map((p, i) => <circle key={i} cx={sx(new Date(p.date).getTime())} cy={sy(p.ndvi)} r="2.2" fill="#2f6b3a" />)}
    </svg>
  );
}
