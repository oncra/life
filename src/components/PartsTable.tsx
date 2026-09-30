import type { Part } from "@/lib/lifebox";
const state: Record<Part["state"], [string, string]> = {
  have: ["have", "bg-accent text-white"],
  coming: ["coming", "bg-amber-500 text-white"],
  "to buy": ["to buy", "border border-line text-muted"],
};
export function PartsTable({ parts }: { parts: Part[] }) {
  if (!parts.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-[#f1efe6] text-left"><tr><th className="p-2">Part</th><th className="p-2">What</th><th className="p-2">Shop</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">EUR</th><th className="p-2">State</th></tr></thead>
        <tbody>
          {parts.map((p) => {
            const [l, c] = state[p.state];
            return (
              <tr key={p.item + p.product} className="border-t border-line align-top">
                <td className="p-2 font-medium whitespace-nowrap">{p.item}</td>
                <td className="p-2">{p.url ? <a className="underline" href={p.url}>{p.product}</a> : p.product}</td>
                <td className="p-2 whitespace-nowrap">{p.shop}</td>
                <td className="p-2 text-right">{p.qty}</td>
                <td className="p-2 text-right">{p.total.toFixed(2)}</td>
                <td className="p-2"><span className={`inline-block rounded-full px-2 py-0.5 text-xs ${c}`} title={p.checked}>{l}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
