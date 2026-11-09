import type { ReactNode } from "react";

// The site's line icons (the roles on the home page, the points in NodeWhy): a 24 px grid drawn in currentColor,
// stroke 1.6 with round ends, so every set looks like one hand drew it. Decorative: the text beside it says the thing.
export default function LineIcon({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
