import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Life oracle",
  description: "An open standard and open software for measuring whether life is thriving in a place. Satellite, sound and soil, combined.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://life.oncra.org"),
};

const nav = [
  ["/map", "Map"],
  ["/places", "Places"],
  ["/docs/greenpaper", "Green paper"],
  ["/docs/spec", "Spec"],
  ["/docs", "Guides"],
  ["/docs/api", "API"],
];
const build = ["/lifebox", "Build a Life Box"];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-line bg-background/90 backdrop-blur sticky top-0 z-[1000]">
          <div className="mx-auto max-w-6xl px-4 h-12 md:h-14 flex items-center gap-4 md:gap-6 text-sm">
            <Link href="/" className="font-semibold tracking-tight flex items-center gap-2 shrink-0 whitespace-nowrap">
              <span className="inline-block w-3 h-3 rounded-full bg-accent" /> Life oracle
            </Link>
            <nav className="flex gap-4 text-sm text-muted overflow-x-auto items-center">
              <Link href={build[0]} className="whitespace-nowrap rounded-full bg-accent text-white px-3 py-1 font-medium">{build[1]}</Link>
              {nav.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-foreground whitespace-nowrap">{label}</Link>
              ))}
              <a href="https://github.com/oncra/life" className="hover:text-foreground whitespace-nowrap">GitHub</a>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line text-xs text-muted">
          <div className="mx-auto max-w-6xl px-4 py-6 flex flex-wrap gap-x-6 gap-y-2">
            <span>Open standard (CC BY 4.0) and open software (Apache-2.0).</span>
            <span>Satellite data: Copernicus Sentinel-2 via Earth Search (Element 84). Basemap: Sentinel-2 cloudless by EOX, OpenStreetMap.</span>
            <span>An Oncra / Climate Cleanup initiative.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
