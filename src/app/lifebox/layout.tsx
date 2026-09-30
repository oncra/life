import type { Metadata } from "next";
import Link from "next/link";
import { listSteps } from "@/lib/lifebox";

export const metadata: Metadata = {
  title: "Life Box: the build plan",
  description: "From a heap of parcels to a Life Box on a post, in six stages with a measured gate each. Every element we have, and what is still missing.",
};

export default function LifeboxLayout({ children }: { children: React.ReactNode }) {
  const steps = listSteps();
  return (
    <div className="lifebox">
      <div className="border-b border-line bg-white/70">
        <div className="mx-auto max-w-5xl px-4 py-2 flex items-center gap-x-4 text-sm overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
          <Link href="/lifebox" className="font-semibold">Life Box</Link>
          <span className="text-muted hidden sm:inline">build plan</span>
          <nav className="flex gap-x-3 text-muted">
            {steps.map((s) => (
              <Link key={s.slug} href={`/lifebox/${s.slug}`} className="hover:text-foreground whitespace-nowrap">
                {s.stage !== undefined ? <><span className="sm:hidden">S{s.stage}</span><span className="hidden sm:inline">Stage {s.stage}</span></> : <><span className="sm:hidden">Have</span><span className="hidden sm:inline">{s.title}</span></>}
              </Link>
            ))}
          </nav>
          <a href="https://life.oncra.org/docs/build" className="ml-auto pl-4 text-muted hover:text-foreground whitespace-nowrap">Long form</a>
        </div>
      </div>
      {children}
    </div>
  );
}
