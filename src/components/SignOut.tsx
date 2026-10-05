"use client";

export function SignOut() {
  return (
    <button type="button" className="underline text-muted" onClick={async () => { await fetch("/api/box/logout", { method: "POST" }); location.href = "/"; }}>
      Sign out
    </button>
  );
}
