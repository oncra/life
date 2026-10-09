import type { Metadata } from "next";
import { backlogEditor, listCards } from "@/lib/backlog";
import { Backlog } from "@/components/Backlog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Backlog: ideas from the build",
  description: "Ideas we come across while building the Life Node and the oracle, on one board.",
};

export default async function BacklogPage() {
  const [cards, editor] = await Promise.all([listCards(), backlogEditor()]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <Backlog initial={JSON.parse(JSON.stringify(cards))} editor={editor} />
    </div>
  );
}
