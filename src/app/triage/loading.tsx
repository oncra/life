// Shown the moment the triage button is tapped, while the page itself is fetched.
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Triage: was the detector right?</h1>
      <p className="mt-4 text-muted text-sm">Loading the species…</p>
      <div className="mt-6 grid gap-4">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg border border-line bg-white" />)}
      </div>
    </div>
  );
}
