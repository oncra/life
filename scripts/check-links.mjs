#!/usr/bin/env node
// Documents in content/ are read on GitHub as well as on the site. A site-absolute link
// (/docs/kit) works here and 404s there, so it is an error; a relative target must exist.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const dir = "content";
const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
const problems = [];

for (const f of files) {
  const path = join(dir, f);
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      const at = `${path}:${i + 1}`;
      if (href.startsWith("/")) problems.push(`${at}  site-absolute link "${href}" — GitHub cannot resolve it; use a relative path or a full https://life.oncra.org URL`);
      else if (!/^(https?:|mailto:|#)/.test(href)) {
        const target = resolve(dirname(path), href.split("#")[0]);
        if (!existsSync(target)) problems.push(`${at}  relative link "${href}" points at nothing`);
      }
    }
  });
}

if (problems.length) {
  console.error(`${problems.length} link problem(s):\n` + problems.map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log(`links ok (${files.length} documents)`);
