import { notFound } from "next/navigation";
import Link from "next/link";
import { getStep, listSteps, partsFor, benchLog } from "@/lib/lifebox";
import { StatusPill } from "@/components/StatusPill";
import { PartsTable } from "@/components/PartsTable";
import { BenchTable } from "@/components/BenchTable";
import { Feedback } from "@/components/Feedback";
import { CopyButtons } from "@/components/CopyButtons";

export function generateStaticParams() { return listSteps().map((s) => ({ step: s.slug })); }

export default async function StepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  const s = getStep(step);
  if (!s) notFound();
  const all = listSteps();
  const i = all.findIndex((x) => x.slug === step);
  const prev = i > 0 ? all[i - 1] : null;
  const next = i >= 0 && i < all.length - 1 ? all[i + 1] : null;
  const parts = partsFor(s.parts);
  const bench = s.stage !== undefined ? benchLog(s.stage) : [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <Link href="/lifebox" className="hover:text-foreground">← Build plan</Link><StatusPill status={s.status} />
      </div>
      {(s.produces || s.gate) && (
        <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
          {s.produces && <div className="rounded-lg border border-line bg-white p-3"><div className="text-xs uppercase tracking-wide text-muted">Produces</div><div className="mt-1">{s.produces}</div></div>}
          {s.gate && <div className="rounded-lg border border-line bg-white p-3"><div className="text-xs uppercase tracking-wide text-muted">Gate</div><div className="mt-1">{s.gate}</div></div>}
        </div>
      )}
      <CopyButtons />
      <article className="prose max-w-none mt-6" dangerouslySetInnerHTML={{ __html: s.html }} />
      {parts.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold">On the table</h2>
          <p className="text-sm text-muted mt-1 mb-3">From <a className="underline" href="https://github.com/oncra/life/blob/main/kit/order-list.csv">kit/order-list.csv</a>. Hover a state for the order it came from.</p>
          <PartsTable parts={parts} />
        </section>
      )}
      {bench.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold">Numbers this stage produces</h2>
          <p className="text-sm text-muted mt-1 mb-3">From <a className="underline" href="https://github.com/oncra/life/blob/main/kit/bench-log.csv">kit/bench-log.csv</a>. A modelled number with nothing beside it is what this stage exists to remove.</p>
          <BenchTable rows={bench} />
        </section>
      )}
      <nav className="mt-10 flex flex-col sm:flex-row gap-2 sm:justify-between text-sm">
        {prev ? <Link href={`/lifebox/${prev.slug}`} className="rounded-md border border-line bg-white px-3 py-2 hover:border-accent text-center">← {prev.title}</Link> : <span />}
        {next ? <Link href={`/lifebox/${next.slug}`} className="rounded-md bg-accent text-white px-3 py-2 text-center">{next.title} →</Link> : <Link href="/lifebox" className="rounded-md border border-line bg-white px-3 py-2">Back to the plan</Link>}
      </nav>
      <Feedback page={step} />
    </div>
  );
}
