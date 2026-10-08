import Link from "next/link";
import Image from "next/image";
import { guide, planIntro, partsFor, purchases, shoppingList } from "@/lib/lifebox";
import { Guide } from "@/components/Guide";
import { Feedback } from "@/components/Feedback";

export default function LifeboxGuide() {
  const sections = guide();
  const intro = planIntro();
  const shops = shoppingList();
  const grand = shops.reduce((s, g) => s + g.total, 0);
  const led = purchases();
  return (
    <Guide sections={sections.map((s) => ({ anchor: s.anchor, title: s.title, steps: s.steps }))}>
      <div className="py-6 md:py-8">
        <div className="grid md:grid-cols-5 gap-6 items-start">
          <div className="md:col-span-3">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">Build a Life Box</h1>
            <div className="prose mt-4 text-[0.98rem]" dangerouslySetInnerHTML={{ __html: intro }} />
            <Link href="/box" className="mt-2 inline-block rounded-lg bg-accent text-white px-4 py-2.5 font-medium">Your box page</Link>
          </div>
          <Image src="/img/life-node-impression.webp" alt="Impression of the Life Box: a small green box on a wooden post under a tilted solar panel, a skylark on the panel" width={1600} height={893} className="md:col-span-2 rounded-lg border border-line w-full" priority />
        </div>

        {sections.map((s, i) => {
          const parts = partsFor(s.parts);
          return (
            <section key={s.slug} id={s.anchor} className="mt-12 scroll-mt-32">
              <div className="border-t-2 border-accent pt-4">
                <div className="text-xs uppercase tracking-wide text-accent font-semibold">Part {i + 1} of {sections.length}</div>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">{s.title}</h2>
                <p className="text-muted mt-1">{s.short}</p>
              </div>
              <article className="prose guide max-w-none mt-4" dangerouslySetInnerHTML={{ __html: s.html }} />
              {s.shopping && (
                <div className="mt-4 grid gap-4">
                  {shops.map((g) => (
                    <div key={g.shop} className="rounded-lg border border-line bg-white overflow-x-auto">
                      <div className="flex items-baseline justify-between gap-3 px-3 py-2 bg-[#f1efe6]"><span className="font-semibold">{g.shop}</span><span className="text-sm text-muted">about EUR {Math.round(g.total)}</span></div>
                      <table className="w-full text-sm min-w-[520px]">
                        <tbody>
                          {g.parts.map((p) => (
                            <tr key={p.item + p.product} className="border-t border-line align-top">
                              <td className="p-2 w-36 font-medium">{p.item}{p.basket === "R2" && <span className="block text-xs font-normal text-muted">optional: the alarm</span>}</td>
                              <td className="p-2">{p.url ? <a className="underline" href={p.url}>{p.product}</a> : p.product}</td>
                              <td className="p-2 text-right whitespace-nowrap">{p.qty} ×</td>
                              <td className="p-2 text-right whitespace-nowrap">{p.total ? `EUR ${p.total.toFixed(2)}` : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <p className="text-sm text-muted">About EUR {Math.round(grand)} for everything, postage not included. From <a className="underline" href="https://github.com/oncra/life/blob/main/kit/order-list.csv">kit/order-list.csv</a>; the reasons behind each choice are on the <Link className="underline" href="/docs/kit">kit page</Link>.</p>
                </div>
              )}
              {parts.length > 0 && (
                <details className="mt-5 rounded-lg border border-line bg-white">
                  <summary className="cursor-pointer px-3 py-2 font-medium">What you need for this part ({parts.length})</summary>
                  <ul className="px-3 pb-3 text-sm grid gap-1">
                    {parts.map((p) => <li key={p.item + p.product}><span className="font-medium">{p.item}</span>: {p.product}</li>)}
                  </ul>
                </details>
              )}
            </section>
          );
        })}

        <section className="mt-14 border-t border-line pt-6 text-sm text-muted">
          <p>The reasoning behind every choice is in the <Link className="underline" href="/docs/build">long build plan</Link> and on the <Link className="underline" href="/docs/kit">kit page</Link>. Comfortable with a terminal? <a className="underline" href="https://github.com/oncra/life/tree/main/node">node/</a> in the repository is the software inside the box. Ideas for later go on the <Link className="underline" href="/backlog">backlog</Link>.</p>
          <details className="mt-4">
            <summary className="cursor-pointer">How node 1 is going: the orders</summary>
            <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-[#f1efe6] text-left"><tr><th className="p-2">Date</th><th className="p-2">Shop</th><th className="p-2">What</th><th className="p-2 text-right">EUR</th><th className="p-2">Status</th></tr></thead>
                <tbody>
                  {led.map((r, i) => (
                    <tr key={i} className="border-t border-line align-top text-foreground">
                      <td className="p-2 whitespace-nowrap">{r.date || "not yet"}</td><td className="p-2 whitespace-nowrap">{r.shop}</td><td className="p-2">{r.what}</td><td className="p-2 text-right whitespace-nowrap">{r.total}</td><td className="p-2">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <Feedback page="index" />
      </div>
    </Guide>
  );
}
