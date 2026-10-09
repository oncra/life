import { permanentRedirect } from "next/navigation";
import { legacyAnchors } from "@/lib/lifebox";

// The plan used to be one page per stage; those links now land on the matching part of the one-page guide.
export default async function OldStep({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  permanentRedirect(`/node#${legacyAnchors[step] ?? ""}`);
}
