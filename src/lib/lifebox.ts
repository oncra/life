// The Life Box build plan (lifebox.oncra.org): short pages in content/lifebox/, one per stage,
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
  if (m) return `/lifebox/${m[1]}${m[2] ?? ""}`;
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
  },
});

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

export function listSteps(): StepMeta[] {
  return fs.readdirSync(root).filter((f) => f.endsWith(".md") && f !== "index.md").map(readMeta).sort((a, b) => a.order - b.order);
}

export function getStep(slug: string): Step | null {
  const file = path.join(root, `${slug}.md`);
  if (!/^[a-z0-9-]+$/.test(slug) || !fs.existsSync(file)) return null;
  const { content } = matter(fs.readFileSync(file, "utf8"));
  return { ...readMeta(`${slug}.md`), html: md.parse(content) as string, raw: content };
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
