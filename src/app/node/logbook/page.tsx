import type { Metadata } from "next";
import Link from "next/link";
import { logbook } from "@/lib/lifebox";
import { Feedback } from "@/components/Feedback";

export const metadata: Metadata = {
  title: "Life Node logbook",
  description: "What building the first Life Node taught us, and what changed in the idea and in the build plan because of it.",
};

// The building and development logbook: content/lifebox/logbook.md, a day per `##`, an entry per `###`, newest first.
export default function Logbook() {
  const log = logbook();
  const entries = log.days.reduce((n, d) => n + d.entries.length, 0);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <p className="text-sm"><Link className="underline" href="/node">← Build a Life Node</Link></p>
      <h1 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">{log.title}</h1>
      <p className="text-muted mt-2">{log.short}</p>

      <nav aria-label="Days in the logbook" className="mt-5 rounded-lg border border-line bg-white px-3 py-2 text-sm">
        <span className="text-muted">{entries} entries over {log.days.length} days: </span>
        {log.days.map((d, i) => (
          <span key={d.id}>
            {i > 0 && <span className="text-muted"> · </span>}
            <a className="underline" href={`#${d.id}`}>{d.title}</a> <span className="text-muted">({d.entries.length})</span>
          </span>
        ))}
      </nav>

      <article className="prose guide max-w-none mt-2" dangerouslySetInnerHTML={{ __html: log.html }} />

      <section className="mt-12 border-t border-line pt-6">
        <Feedback page="logbook" />
      </section>
    </div>
  );
}
