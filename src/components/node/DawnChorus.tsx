import type { NodeOut } from "@/lib/node";

/** Detections per hour of the day over the last fortnight, as a grid: the dawn chorus shows up as a dark column. */
export default function DawnChorus({ chorus }: { chorus: NodeOut["chorus"] }) {
  const { days, cells, max } = chorus;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="text-xs">
      <div className="grid gap-px" style={{ gridTemplateColumns: "4.9rem repeat(24, minmax(0, 1fr))" }}>
        <div />
        {hours.map((h) => <div key={h} className="text-muted text-center leading-4">{h % 6 === 0 ? `${h}h` : ""}</div>)}
        {days.map((d, i) => (
          <DayRow key={d.t} label={d.label} cells={hours.map((h) => cells[`${i}:${h}`] ?? 0)} max={max} />
        ))}
      </div>
      <div className="mt-1.5 text-muted">{max ? `Darkest cell: ${max} detection${max === 1 ? "" : "s"} in one hour. Local time.` : "Nothing heard in the last fourteen days."}</div>
    </div>
  );
}

function DayRow({ label, cells, max }: { label: string; cells: number[]; max: number }) {
  return (
    <>
      <div className="text-muted leading-4 pr-1 whitespace-nowrap">{label}</div>
      {cells.map((n, h) => {
        const a = max ? Math.sqrt(n / max) : 0;
        return <div key={h} className="h-4 rounded-[2px]" style={{ background: n ? `rgba(47, 107, 58, ${0.15 + 0.85 * a})` : "#f1efe6" }} title={`${label}, ${h}:00 to ${h + 1}:00: ${n} detection${n === 1 ? "" : "s"}`} />;
      })}
    </>
  );
}
