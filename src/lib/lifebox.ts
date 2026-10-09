// The Life Node build plan (served at /node): short pages in content/lifebox/, one per stage,
// with the parts, the ledger and the bench log read from kit/*.csv so the pages cannot drift
// from the files that are the source of truth.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { Marked } from "marked";
import { slugify } from "./markdown";

const root = path.join(process.cwd(), "content", "lifebox");
const kit = path.join(process.cwd(), "kit");

// Links in content/lifebox/ follow the repository rule (they must work on GitHub too):
// a sibling page is `1-bench.md`, a document is `../build.md`, an image `../../public/img/x`.
function siteHref(href: string): string {
  let m = /^([a-z0-9-]+)\.md(#.*)?$/.exec(href);
  if (m) return m[1] === "index" ? `/node${m[2] ?? ""}` : `/node/${m[1]}${m[2] ?? ""}`;
  m = /^\.\.\/([a-z0-9-]+)\.md(#.*)?$/.exec(href);
  if (m) return `/docs/${m[1]}${m[2] ?? ""}`;
  if (href.startsWith("../../public/")) return href.slice("../../public".length);
  return href;
}

const md = new Marked({
  gfm: true,
  walkTokens(token) {
    if ((token.type === "link" || token.type === "image") && typeof token.href === "string") token.href = siteHref(token.href);
  },
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`;
    },
    // ```ai <title>  ->  a boxed instruction for a coding agent, with a copy button (wired by <CopyButtons/>).
    code({ text, lang }) {
      const m = /^ai(?:\s+(.*))?$/.exec(lang ?? "");
      if (!m) return `<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(text)}</code></pre>\n`;
      const title = m[1] ? `: ${esc(m[1])}` : "";
      return `<div class="ai-box"><div class="ai-head"><span>For an AI agent${title}</span><button type="button" class="ai-copy">Copy</button></div><pre><code>${esc(text)}</code></pre></div>\n`;
    },
    // ![alt](src "caption")  ->  a figure with the caption under it
    image({ href, title, text }) {
      const cap = title ? `<figcaption>${esc(title)}</figcaption>` : "";
      return `<figure><img src="${esc(href)}" alt="${esc(text)}" loading="lazy" />${cap}</figure>`;
    },
  },
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type StepStatus = "done" | "now" | "next" | "later";

export interface StepMeta {
  slug: string;
  title: string;
  short: string;
  order: number;
  /** stage number as it appears in kit/bench-log.csv ("1" matches 1.2, 1.3 ...) */
  stage?: string;
  produces?: string;
  gate?: string;
  status: StepStatus;
  /** `item` values from kit/order-list.csv that are on the table in this stage */
  parts: string[];
}

export interface Step extends StepMeta { html: string; raw: string }

function readMeta(file: string): StepMeta {
  const { data } = matter(fs.readFileSync(path.join(root, file), "utf8"));
  return {
    slug: file.replace(/\.md$/, ""),
    title: String(data.title ?? file),
    short: String(data.short ?? ""),
    order: Number(data.order ?? 99),
    stage: data.stage === undefined ? undefined : String(data.stage),
    produces: data.produces ? String(data.produces) : undefined,
    gate: data.gate ? String(data.gate) : undefined,
    status: (data.status as StepStatus) ?? "later",
    parts: Array.isArray(data.parts) ? data.parts.map(String) : [],
  };
}

/** Pages in content/lifebox/ that are not parts of the guide: the intro and the logbook. */
const notParts = new Set(["index.md", "logbook.md"]);

export function listSteps(): StepMeta[] {
  return fs.readdirSync(root).filter((f) => f.endsWith(".md") && !notParts.has(f)).map(readMeta).sort((a, b) => a.order - b.order);
}

export function getStep(slug: string): Step | null {
  const file = path.join(root, `${slug}.md`);
  if (!/^[a-z0-9-]+$/.test(slug) || !fs.existsSync(file)) return null;
  const { content } = matter(fs.readFileSync(file, "utf8"));
  return { ...readMeta(`${slug}.md`), html: md.parse(content) as string, raw: content };
}

/** The overview's intro (content/lifebox/index.md), rendered with the plan's own rules (ai boxes, figures, links). */
export function planIntro(): string {
  const { content } = matter(fs.readFileSync(path.join(root, "index.md"), "utf8"));
  return md.parse(content) as string;
}

export interface LogDay { id: string; title: string; entries: string[] }

/** The logbook (content/lifebox/logbook.md, served at /node/logbook): a `##` per day, newest first, a `###` per entry. */
export function logbook(): { title: string; short: string; html: string; days: LogDay[] } {
  const { data, content } = matter(fs.readFileSync(path.join(root, "logbook.md"), "utf8"));
  const days: LogDay[] = [];
  for (const line of content.split("\n")) {
    const day = /^## (.+)$/.exec(line);
    if (day) { days.push({ id: slugify(day[1]), title: day[1], entries: [] }); continue; }
    const entry = /^### (.+)$/.exec(line);
    if (entry && days.length) days[days.length - 1].entries.push(entry[1]);
  }
  return { title: String(data.title ?? "Logbook"), short: String(data.short ?? ""), html: md.parse(content) as string, days };
}

export function isPlanPage(slug: string): boolean {
  return slug === "index" || (/^[a-z0-9-]+$/.test(slug) && fs.existsSync(path.join(root, `${slug}.md`)));
}

// --- kit/*.csv -----------------------------------------------------------------------

export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

function csv(name: string): Row[] {
  return parseCsv(fs.readFileSync(path.join(kit, name), "utf8"));
}

export interface Part {
  basket: string; shop: string; item: string; product: string; url: string;
  price: number; qty: number; total: number; checked: string; notes: string;
  state: "have" | "coming" | "to buy";
}

// The state of a part comes from the purchases ledger (kit/node-1-purchases.csv), matched by shop;
// the guard basket (R2) is its own reichelt order. Nothing in the ledger means it is still to buy.
function partState(basket: string, shop: string, checked: string, ledger: Purchase[]): Part["state"] {
  if (/estimate/i.test(checked)) return "to buy";
  const word = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0];
  const w = word(shop);
  let rows = ledger.filter((r) => word(r.shop) === w && !/cancelled/i.test(r.status));
  if (basket === "R2") rows = rows.filter((r) => /guard/i.test(r.what));
  else rows = rows.filter((r) => !/guard/i.test(r.what));
  const row = rows[0];
  if (!row || !row.date || /not (ordered|bought)/i.test(row.status)) return /bought|paid/i.test(checked) ? "coming" : "to buy";
  return /delivered/i.test(row.status) ? "have" : "coming";
}

export function orderList(): Part[] {
  const ledger = purchases();
  return csv("order-list.csv")
    .filter((r) => r.basket !== "alt")
    .map((r) => ({
      basket: r.basket, shop: r.shop, item: r.item, product: r.product, url: r.order_url,
      price: Number(r.unit_price_eur_incl_vat || 0), qty: Number(r.qty || 0), total: Number(r.line_total_eur || 0),
      checked: r.checked, notes: r.notes, state: partState(r.basket, r.shop, r.checked, ledger),
    }));
}

export function partsFor(items: string[]): Part[] {
  const all = orderList();
  const want = new Set(items.map((s) => s.toLowerCase()));
  return all.filter((p) => want.has(p.item.toLowerCase()));
}

export interface Purchase { date: string; shop: string; order: string; what: string; total: string; vat: string; status: string; notes: string }

export function purchases(): Purchase[] {
  return csv("node-1-purchases.csv").map((r) => ({ date: r.date, shop: r.shop, order: r.order, what: r.what, total: r.total_eur, vat: r.vat, status: r.status, notes: r.notes }));
}

export interface BenchRow { stage: string; what: string; how: string; modelled: string; unit: string; measured: string; date: string; notes: string }

export function benchLog(stage?: string): BenchRow[] {
  const rows = csv("bench-log.csv").map((r) => ({ stage: r.stage, what: r.what, how: r.how, modelled: r.modelled, unit: r.unit, measured: r.measured, date: r.date, notes: r.notes }));
  if (!stage) return rows;
  return rows.filter((r) => r.stage === stage || r.stage.startsWith(`${stage}.`));
}

export function planTotals() {
  const parts = orderList();
  const total = parts.reduce((s, p) => s + p.total, 0);
  const have = parts.filter((p) => p.state !== "to buy").reduce((s, p) => s + p.total, 0);
  const bench = benchLog();
  return {
    partsTotal: total, partsBought: have, partsToBuy: total - have,
    lines: parts.length, linesBought: parts.filter((p) => p.state !== "to buy").length,
    benchRows: bench.length, benchMeasured: bench.filter((r) => r.measured !== "").length,
  };
}

// --- the one-page build guide ---------------------------------------------------------
// All parts of content/lifebox/ on one page, in `order`. Every `##` heading is a step, numbered across the whole
// guide; a blockquote that starts with **Check.** becomes the step's check card.

export interface GuideStep { id: string; n: number; title: string }
export interface GuideSection { slug: string; anchor: string; title: string; short: string; parts: string[]; shopping: boolean; html: string; steps: GuideStep[] }

export function guide(): GuideSection[] {
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".md") && !notParts.has(f)).sort();
  let n = 0;
  const seen = new Set<string>();
  return files
    .map((f) => ({ f, ...matter(fs.readFileSync(path.join(root, f), "utf8")) }))
    .sort((a, b) => Number(a.data.order ?? 99) - Number(b.data.order ?? 99))
    .map(({ f, data, content }) => {
      const steps: GuideStep[] = [];
      const g = new Marked({
        gfm: true,
        walkTokens(token) {
          if ((token.type === "link" || token.type === "image") && typeof token.href === "string") token.href = siteHref(token.href);
        },
        renderer: {
          heading({ tokens, depth }) {
            const text = this.parser.parseInline(tokens);
            if (depth !== 2) return `<h${depth}>${text}</h${depth}>\n`;
            let id = slugify(text.replace(/<[^>]+>/g, ""));
            while (seen.has(id)) id += "-2";
            seen.add(id);
            steps.push({ id, n: ++n, title: text.replace(/<[^>]+>/g, "") });
            return `<h2 id="${id}" class="step-head" data-step="${n}"><span class="step-n">${n}</span><span>${text}</span></h2>\n`;
          },
          blockquote({ tokens }) {
            const inner = this.parser.parse(tokens);
            const check = /^<p><strong>Check\.<\/strong>/.test(inner.trim());
            return check ? `<div class="check">${inner.replace("<strong>Check.</strong>", '<strong class="check-label">Check</strong>')}</div>\n` : `<blockquote>${inner}</blockquote>\n`;
          },
          image({ href, title, text }) {
            const cap = title ? `<figcaption>${esc(title)}</figcaption>` : "";
            return `<figure><img src="${esc(href)}" alt="${esc(text)}" loading="lazy" />${cap}</figure>`;
          },
        },
      });
      const html = g.parse(content) as string;
      const slug = f.replace(/\.md$/, "");
      return {
        slug, anchor: slug.replace(/^\d+-/, ""), title: String(data.title ?? slug), short: String(data.short ?? ""),
        parts: Array.isArray(data.parts) ? data.parts.map(String) : [], shopping: data.shopping === true, html, steps,
      };
    });
}

/** Old one-page-per-stage links land on the matching part of the one-page guide. */
export const legacyAnchors: Record<string, string> = {
  have: "order", "0-before": "software", "1-bench": "desk", "2-power": "power", "3-box": "box", "4-post": "field", "5-soak": "watch",
};

/** The order list grouped by shop, for the "order the parts" step. */
export function shoppingList(): { shop: string; parts: Part[]; total: number }[] {
  const by = new Map<string, Part[]>();
  for (const p of orderList()) {
    const shop = /bouwmarkt|cables\/connectors/i.test(p.shop) ? "DIY shop or electronics shop" : p.shop;
    by.set(shop, [...(by.get(shop) ?? []), p]);
  }
  return [...by.entries()]
    .map(([shop, parts]) => ({ shop, parts: [...parts].sort((a, b) => Number(a.basket === "R2") - Number(b.basket === "R2")), total: parts.reduce((s, p) => s + p.total, 0) }))
    .sort((a, b) => (a.shop.startsWith("DIY") ? 1 : 0) - (b.shop.startsWith("DIY") ? 1 : 0) || b.total - a.total);
}
