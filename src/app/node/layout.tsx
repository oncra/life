import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Build a Life Node",
  description: "From ordering the parts to a box on a post that reports by itself: every step on one page, each with a check you can see.",
};

export default function LifeboxLayout({ children }: { children: React.ReactNode }) {
  return <div className="lifebox">{children}</div>;
}
