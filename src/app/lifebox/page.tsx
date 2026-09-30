import Link from "next/link";
import Image from "next/image";
import { listSteps, planTotals, purchases, planIntro } from "@/lib/lifebox";
import { CopyButtons } from "@/components/CopyButtons";
import { StatusPill } from "@/components/StatusPill";
import { Feedback } from "@/components/Feedback";

export default function LifeboxHome() {
  const steps = listSteps();
  const t = planTotals();
  const intro = planIntro();
  const led = purchases();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:py-8">
      <CopyButtons />
      <div className="grid md:grid-cols-5 gap-8 items-start">
        <div className="md:col-span-3">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">Life Box: the build plan</h1>
          <div className="prose mt-4 text-[0.98rem]" dangerouslySetInnerHTML={{ __html: intro }} />
        </div>
        <div className="md:col-span-2">
          <Image src="/img/life-node-impression.webp" alt="Impression of the Life Box: a small green box on a wooden post under a tilted solar panel, a skylark on the panel" width={1600} height={893} className="rounded-lg border border-line w-full" priority />
          <div className="grid grid-cols-3 gap-2 mt-3 text-center text-sm">
            <div className="rounded-lg border border-line bg-white p-3"><div className="text-xl font-semibold">{t.linesBought}/{t.lines}</div><div className="text-xs text-muted">part lines bought</div></div>
            <div className="rounded-lg border border-line bg-white p-3"><div className="text-xl font-semibold">{Math.round(t.partsBought)}</div><div className="text-xs text-muted">EUR of {Math.round(t.partsTotal)} spent</div></div>
            <div className="rounded-lg border border-line bg-white p-3"><div className="text-xl font-semibold">{t.benchMeasured}/{t.benchRows}</div><div className="text-xs text-muted">numbers measured</div></div>
          </div>
        </div>
      </div>

      <h2 className="mt-10 text-xl font-semibold">The stages</h2>
      <ol className="mt-3 grid gap-3">
        {steps.map((s) => (
          <li key={s.slug}>
            <Link href={`/lifebox/${s.slug}`} className="block rounded-lg border border-line bg-white p-4 hover:border-accent">
              <div className="flex items-center gap-3">
                <div className="font-semibold">{s.title}</div>
                <StatusPill status={s.status} />
              </div>
              <div className="text-sm text-muted mt-1">{s.short}</div>
              {s.gate && <div className="text-sm mt-2"><span className="font-medium">Gate:</span> {s.gate}</div>}
            </Link>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 text-xl font-semibold">Orders for node 1</h2>
      <p className="text-sm text-muted mt-1">Read from <a className="underline" href="https://github.com/oncra/life/blob/main/kit/node-1-purchases.csv">kit/node-1-purchases.csv</a>.</p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-[#f1efe6] text-left"><tr><th className="p-2">Date</th><th className="p-2">Shop</th><th className="p-2">What</th><th className="p-2 text-right">EUR</th><th className="p-2">Status</th></tr></thead>
          <tbody>
            {led.map((r, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="p-2 whitespace-nowrap">{r.date || "not yet"}</td>
                <td className="p-2 whitespace-nowrap">{r.shop}</td>
                <td className="p-2">{r.what}</td>
                <td className="p-2 text-right whitespace-nowrap">{r.total}</td>
                <td className="p-2">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Feedback page="index" />
    </div>
  );
}
