import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const root = path.join(process.cwd(), "content");

export function slugify(text: string): string {
  return text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

// Links in content/ are written so that GitHub resolves them when it renders the same file:
// a sibling document is `kit.md`, an image is `../public/img/x`. Both are rewritten here to the
// routes this site serves, so one link works in both places.
function siteHref(href: string): string {
  const doc = /^([a-z0-9-]+)\.md(#.*)?$/.exec(href);
  if (doc) return `/docs/${doc[1]}${doc[2] ?? ""}`;
  if (href.startsWith("../public/")) return href.slice("../public".length);
  return href;
}

marked.use({
  walkTokens(token) {
    if ((token.type === "link" || token.type === "image") && typeof token.href === "string") token.href = siteHref(token.href);
  },
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`;
    },
  },
});

export interface Doc { slug: string; title: string; summary?: string; order?: number; html: string; raw: string }

export function listDocs(): Omit<Doc, "html" | "raw">[] {
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data } = matter(fs.readFileSync(path.join(root, f), "utf8"));
      return { slug: f.replace(/\.md$/, ""), title: (data.title as string) ?? f, summary: data.summary as string | undefined, order: (data.order as number) ?? 99 };
    })
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

export function getDoc(slug: string): Doc | null {
  const file = path.join(root, `${slug}.md`);
  if (!/^[a-z0-9-]+$/.test(slug) || !fs.existsSync(file)) return null;
  const { data, content } = matter(fs.readFileSync(file, "utf8"));
  const html = marked.parse(content, { gfm: true }) as string;
  return { slug, title: (data.title as string) ?? slug, summary: data.summary as string | undefined, order: data.order as number | undefined, html, raw: content };
}
