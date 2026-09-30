import type { BenchRow } from "@/lib/lifebox";
export function BenchTable({ rows }: { rows: BenchRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-[#f1efe6] text-left"><tr><th className="p-2">Step</th><th className="p-2">Number</th><th className="p-2 hidden md:table-cell">How</th><th className="p-2 text-right">Modelled</th><th className="p-2 text-right">Measured</th><th className="p-2">Unit</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="p-2 whitespace-nowrap">{r.stage}</td>
              <td className="p-2">{r.what}{r.notes && <div className="text-xs text-muted">{r.notes}</div>}</td>
              <td className="p-2 text-muted hidden md:table-cell">{r.how}</td>
              <td className="p-2 text-right">{r.modelled}</td>
              <td className={`p-2 text-right font-medium ${r.measured ? "" : "text-amber-700"}`}>{r.measured || "not yet"}</td>
              <td className="p-2">{r.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
