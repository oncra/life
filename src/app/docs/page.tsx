import Link from "next/link";
import { listDocs } from "@/lib/markdown";
export default function Docs() {
  const docs = listDocs();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Guides and documents</h1>
      <p className="text-sm text-muted mt-1">Everything here is also in the <a className="underline" href="https://github.com/oncra/life/tree/main/content">repository</a>. Improve it by pull request.</p>
      <ul className="mt-6 space-y-3">
        {docs.map((d) => (
          <li key={d.slug}><Link href={`/docs/${d.slug}`} className="block rounded-lg border border-line bg-white p-4 hover:border-accent"><div className="font-medium">{d.title}</div>{d.summary && <div className="text-sm text-muted mt-1">{d.summary}</div>}</Link></li>
        ))}
      </ul>
    </div>
  );
}
