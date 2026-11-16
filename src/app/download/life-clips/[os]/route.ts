// The Life Clips app for a laptop (clients/clips-app), from the newest clips-app-v* release on GitHub: a link on the
// node page that stays the same across releases. For a Mac, the app that runs on Apple silicon and Intel alike, signed
// and notarized, so it opens with a double click (Life-Clips-Mac.zip); a release from before it had one program per
// processor. Without an answer from GitHub, the releases page.

export const dynamic = "force-dynamic";

const REPO = "oncra/life";
const PAGE = `https://github.com/${REPO}/releases?q=clips-app&expanded=true`;
const WANT: Record<string, string[]> = {
  mac: ["Life-Clips-Mac.zip", "life-clips-mac-Apple-M1-or-later"],
  "mac-intel": ["Life-Clips-Mac.zip", "life-clips-mac-Intel"],
  windows: ["life-clips-windows.exe"],
};

type Release = { tag_name: string; draft: boolean; prerelease: boolean; assets: { name: string; browser_download_url: string }[] };

let cache: { at: number; release: Release | null } | null = null;

/** The newest published Life Clips release, asked of GitHub at most every ten minutes (60 an hour are allowed without a
 * token). GitHub lists the newest first. */
async function newest(): Promise<Release | null> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.release;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "life.oncra.org" }, cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const all = (await r.json()) as Release[];
  const release = all.find((x) => !x.draft && !x.prerelease && x.tag_name.startsWith("clips-app-v")) ?? null;
  cache = { at: Date.now(), release };
  return release;
}

export async function GET(_req: Request, { params }: { params: Promise<{ os: string }> }) {
  const want = WANT[(await params).os];
  if (!want) return Response.json({ error: "mac, mac-intel or windows" }, { status: 404 });
  let to = PAGE;
  try {
    const assets = (await newest())?.assets ?? [];
    to = want.map((name) => assets.find((a) => a.name === name)?.browser_download_url).find(Boolean) ?? PAGE;
  } catch {
    // GitHub slow or saying no: its page has the files too
  }
  return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
}
