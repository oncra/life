import { notFound } from "next/navigation";
import Link from "next/link";
import { getDoc, listDocs } from "@/lib/markdown";
export function generateStaticParams() { return listDocs().map((d) => ({ slug: d.slug })); }
export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  const all = listDocs();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 grid lg:grid-cols-4 gap-8">
      <aside className="lg:col-span-1 text-sm order-2 lg:order-1">
        <div className="lg:sticky lg:top-20 space-y-1">
          {all.map((d) => <Link key={d.slug} href={`/docs/${d.slug}`} className={`block px-2 py-1 rounded ${d.slug === slug ? "bg-white border border-line font-medium" : "text-muted hover:text-foreground"}`}>{d.title}</Link>)}
          <a className="block px-2 py-1 text-muted hover:text-foreground" href={`https://github.com/oncra/life/edit/main/content/${slug}.md`}>Edit this page</a>
        </div>
      </aside>
      <article className="lg:col-span-3 prose max-w-none order-1 lg:order-2" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}
