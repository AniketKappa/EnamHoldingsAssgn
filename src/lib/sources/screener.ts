// screener.in company pages: standardised multi-year financials plus links to
// annual reports and concall transcripts. FINN uses the tables and the links,
// never screener's own prose (About, pros/cons, AI summaries).
import * as cheerio from "cheerio";
import { getText, HttpError } from "./http";

export type Basis = "consolidated" | "standalone";

export interface ScreenerTable {
  periods: { label: string; date: string | null }[];
  rows: { label: string; key: string; values: (number | null)[]; unit: string }[];
}

export interface ScreenerCompany {
  symbol: string;
  name: string;
  basis: Basis;
  bseCode: string | null;
  top: Record<string, number | null>;
  tables: Partial<Record<"quarters" | "profit_loss" | "balance_sheet" | "cash_flow" | "ratios", ScreenerTable>>;
  annualReports: { year: number; url: string }[];
  concalls: { label: string; date: string | null; transcript: string | null; ppt: string | null; rec: string | null }[];
  url: string;
}

const LABEL_KEYS: Record<string, string> = {
  "sales": "revenue",
  "revenue": "revenue",
  "expenses": "expenses",
  "operating profit": "ebitda",
  "financing profit": "financing_profit",
  "opm %": "opm_pct",
  "financing margin %": "financing_margin_pct",
  "other income": "other_income",
  "interest": "interest",
  "depreciation": "depreciation",
  "profit before tax": "pbt",
  "tax %": "tax_pct",
  "net profit": "pat",
  "eps in rs": "eps",
  "dividend payout %": "dividend_payout_pct",
  "equity capital": "equity_capital",
  "reserves": "reserves",
  "borrowings": "borrowings",
  "borrowing": "borrowings",
  "deposits": "deposits",
  "other liabilities": "other_liabilities",
  "total liabilities": "total_liabilities",
  "fixed assets": "fixed_assets",
  "cwip": "cwip",
  "investments": "investments",
  "other assets": "other_assets",
  "total assets": "total_assets",
  "cash from operating activity": "cfo",
  "cash from investing activity": "cfi",
  "cash from financing activity": "cff",
  "net cash flow": "net_cash_flow",
  "free cash flow": "fcf",
  "cfo/ebitda": "cfo_ebitda_pct",
  "debtor days": "debtor_days",
  "inventory days": "inventory_days",
  "days payable": "days_payable",
  "cash conversion cycle": "ccc_days",
  "working capital days": "wc_days",
  "roce %": "roce_pct",
  "roe %": "roe_pct",
};

const TOP_KEYS: Record<string, string> = {
  "market cap": "market_cap_cr",
  "current price": "price",
  "stock p/e": "pe",
  "book value": "book_value",
  "dividend yield": "dividend_yield_pct",
  "roce": "roce_pct",
  "roe": "roe_pct",
  "face value": "face_value",
};

export function normLabel(s: string): string {
  return s
    .replace(/ /g, " ")
    .replace(/\+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseNum(s: string | undefined | null): number | null {
  if (s === undefined || s === null) return null;
  const t = s.replace(/[,\s₹%]/g, "").replace(/Cr\.?$/i, "");
  if (!t || t === "-" || t === "--") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function unitFor(key: string): string {
  if (key.endsWith("_pct")) return "pct";
  if (key.endsWith("_days") || key.startsWith("days_")) return "days";
  if (key === "eps") return "rs";
  return "cr";
}

function parseTable($: cheerio.CheerioAPI, sectionId: string): ScreenerTable | undefined {
  const section = $(`section#${sectionId}`);
  if (!section.length) return undefined;
  const table = section.find("div[data-result-table] table").first();
  if (!table.length) return undefined;
  const periods = table.find("thead th").slice(1).map((_, th) => {
    const label = $(th).text().replace(/\s+/g, " ").trim();
    const key = $(th).attr("data-date-key") ?? null;
    return { label, date: key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null };
  }).get();
  const rows: ScreenerTable["rows"] = [];
  table.find("tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (!cells.length) return;
    const labelCell = cells.first().clone();
    labelCell.find(".tooltip, .has-tooltip").remove();
    const label = normLabel(labelCell.text());
    if (!label || label === "raw pdf") return;
    const key = LABEL_KEYS[label] ?? label.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const values = cells.slice(1).map((__, td) => parseNum($(td).text())).get();
    rows.push({ label, key, values, unit: unitFor(key) });
  });
  return { periods, rows };
}

export function parseScreenerHtml(html: string, symbol: string, url: string): ScreenerCompany {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const subText = $("section#quarters p.sub, section#profit-loss p.sub").first().text().toLowerCase();
  const basis: Basis = subText.includes("standalone") && !subText.includes("view standalone") ? "standalone"
    : subText.includes("consolidated") ? "consolidated" : "standalone";

  const bseHref = $('a[href*="bseindia.com/stock-share-price/"]').first().attr("href") ?? "";
  const bseMatch = bseHref.match(/\/(\d{6})\/?$/);

  const top: Record<string, number | null> = {};
  $("#top-ratios li").each((_, li) => {
    const n = normLabel($(li).find(".name").text());
    const key = TOP_KEYS[n];
    if (!key) return;
    top[key] = parseNum($(li).find(".number").first().text());
  });

  const tables: ScreenerCompany["tables"] = {
    quarters: parseTable($, "quarters"),
    profit_loss: parseTable($, "profit-loss"),
    balance_sheet: parseTable($, "balance-sheet"),
    cash_flow: parseTable($, "cash-flow"),
    ratios: parseTable($, "ratios"),
  };

  const annualReports: ScreenerCompany["annualReports"] = [];
  $(".documents.annual-reports a").each((_, a) => {
    const t = $(a).text().trim();
    const m = t.match(/(\d{4})/);
    const href = $(a).attr("href");
    if (m && href && /\.pdf/i.test(href)) annualReports.push({ year: +m[1], url: href });
  });

  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const concalls: ScreenerCompany["concalls"] = [];
  $(".documents.concalls li").each((_, li) => {
    const label = $(li).children("div").first().text().replace(/\s+/g, " ").trim();
    const link = (name: string) => {
      const a = $(li).find("a.button-chip").filter((__, el) => $(el).text().trim().toLowerCase() === name);
      return a.length ? a.attr("href") ?? null : null;
    };
    const m = label.match(/^([A-Za-z]{3})\s+(\d{4})$/);
    concalls.push({
      label,
      date: m ? `${m[2]}-${months[m[1].toLowerCase()]}-15` : null,
      transcript: link("transcript"),
      ppt: link("ppt"),
      rec: link("rec"),
    });
  });

  return { symbol, name, basis, bseCode: bseMatch ? bseMatch[1] : null, top, tables, annualReports, concalls, url };
}

export function screenerUrl(symbol: string, basis: Basis): string {
  const s = encodeURIComponent(symbol.toUpperCase());
  return basis === "consolidated"
    ? `https://www.screener.in/company/${s}/consolidated/`
    : `https://www.screener.in/company/${s}/`;
}

/** Fetch consolidated figures when they exist, else standalone. */
export async function fetchScreener(symbol: string, fetchHtml: (url: string) => Promise<string> = defaultFetch): Promise<ScreenerCompany> {
  const cUrl = screenerUrl(symbol, "consolidated");
  try {
    const html = await fetchHtml(cUrl);
    const parsed = parseScreenerHtml(html, symbol, cUrl);
    const q = parsed.tables.quarters;
    const hasData = !!q && q.rows.some((r) => r.values.some((v) => v !== null));
    if (parsed.basis === "consolidated" && hasData) return parsed;
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
  }
  const sUrl = screenerUrl(symbol, "standalone");
  const html = await fetchHtml(sUrl);
  const parsed = parseScreenerHtml(html, symbol, sUrl);
  return { ...parsed, basis: "standalone" };
}

async function defaultFetch(url: string): Promise<string> {
  return getText(url, { headers: { Accept: "text/html,application/xhtml+xml" }, timeoutMs: 25_000 });
}

/** Convenience: series for a key in a table, aligned to periods. */
export function series(t: ScreenerTable | undefined, key: string): { period: string; date: string | null; value: number | null }[] {
  if (!t) return [];
  const row = t.rows.find((r) => r.key === key);
  if (!row) return [];
  return t.periods.map((p, i) => ({ period: p.label, date: p.date, value: row.values[i] ?? null }));
}
