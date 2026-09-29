import type { StepStatus } from "@/lib/lifebox";
const label: Record<StepStatus, string> = { done: "done", now: "now", next: "next", later: "later" };
const cls: Record<StepStatus, string> = {
  done: "bg-accent text-white",
  now: "bg-amber-500 text-white",
  next: "border border-amber-500 text-amber-700",
  later: "border border-line text-muted",
};
export function StatusPill({ status }: { status: StepStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls[status]}`}>{label[status]}</span>;
}
