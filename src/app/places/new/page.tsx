import NewPlaceForm from "@/components/NewPlaceForm";
export default function NewPlace() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Register a place</h1>
      <p className="text-sm text-muted mt-1 max-w-3xl">Click on the map to draw the boundary (right-click to start over). Give it a name and a land use. You need a steward or admin key; during the pilot, ask for one at <a className="underline" href="mailto:sven@climatecleanup.org">sven@climatecleanup.org</a> or run your own instance. On submit the satellite backfill starts immediately: seven years of Sentinel-2, usually done within ten minutes.</p>
      <NewPlaceForm />
    </div>
  );
}
