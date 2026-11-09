"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

// The way in, pinned at the right of the header and outside the nav that scrolls on a phone: "Sign in" for a
// visitor, "Your places" once signed in. A client component so the guides and the build guide stay static pages;
// it asks /api/me once per page load and shows "Sign in" until the answer is there.
export default function AccountLink() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setSignedIn(j?.signedIn === true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <Link
      href="/me"
      className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-full border border-accent px-3 py-1 font-medium text-accent hover:bg-accent hover:text-white"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="8" cy="5.5" r="2.75" />
        <path d="M2.75 13.75c.8-2.5 2.9-3.9 5.25-3.9s4.45 1.4 5.25 3.9" />
      </svg>
      {signedIn ? "Your places" : "Sign in"}
    </Link>
  );
}
