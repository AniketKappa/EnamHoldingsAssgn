// Quarterly results card: the first cut of Revenue, EBITDA, PBT and PAT, this
// quarter vs last quarter (QoQ) and vs the same quarter last year (YoY).
// The model reads 1-2 targeted pages; arithmetic, units and checks are code.
import type { ResultsExtractT, ResultLinesT } from "../llm/schemas";
import { fiscalQuarterLabel } from "../time";

export interface Lines {
  period_end: string;
  revenue: number | null;
  other_income: number | null;
  total_income: number | null;
  finance_costs: number | null;
  da: number | null;
  total_expenses: number | null;
  pbt_pre_exc: number | null;
  exceptional: number | null;
  share_assoc: number | null;
  pbt: number;
  tax: number | null;
  pat_total: number;
  pat_owners: number | null;
  interest_earned: number | null;
  interest_expended: number | null;
  operating_expenses: number | null;
  provisions: number | null;
  gnpa_pct: number | null;
}

export type Template = "corporate" | "lender";

const FACTOR: Record<ResultsExtractT["unit"], number> = {
  crore: 1, lakh: 0.01, million: 0.1, thousand: 0.0001, rupees: 1e-7,
};

export function toLines(r: ResultLinesT, unit: ResultsExtractT["unit"]): Lines {
  const f = FACTOR[unit];
  const c = (v: number | null | undefined) => (v === null || v === undefined ? null : round2(v * f));
  return {
    period_end: r.period_end,
    revenue: c(r.revenue_from_operations),
    other_income: c(r.other_income),
    total_income: c(r.total_income),
    finance_costs: c(r.finance_costs),
    da: c(r.depreciation_amortisation),
    total_expenses: c(r.total_expenses),
    pbt_pre_exc: c(r.profit_before_exceptional_and_tax),
    exceptional: c(r.exceptional_items),
    share_assoc: c(r.share_of_associates_jv),
    pbt: c(r.profit_before_tax) ?? 0,
    tax: c(r.tax_expense),
    pat_total: c(r.profit_after_tax_total) ?? 0,
    pat_owners: c(r.profit_after_tax_owners),
    interest_earned: c(r.interest_earned),
    interest_expended: c(r.interest_expended),
    operating_expenses: c(r.operating_expenses),
    provisions: c(r.provisions),
    gnpa_pct: r.gross_npa_pct ?? null, // a ratio, never scaled
  };
}

function round2(v: number) { return Math.round(v * 100) / 100; }

/** EBITDA (excluding other income) = revenue - operating expenses. */
export function ebitda(l: Lines): number | null {
  if (l.revenue !== null && l.total_expenses !== null && l.finance_costs !== null && l.da !== null) {
    return round2(l.revenue - (l.total_expenses - l.finance_costs - l.da));
  }
  const base = l.pbt_pre_exc ?? (l.exceptional !== null ? l.pbt - l.exceptional : null);
  if (base !== null && l.finance_costs !== null && l.da !== null && l.other_income !== null) {
    return round2(base + l.finance_costs + l.da - l.other_income);
  }
  return null;
}

export interface Metric {
  value: number | null;
  prev: number | null;
  yoy: number | null;
  qoq_pct: number | null;
  yoy_pct: number | null;
}

export interface ResultsMetrics {
  template: Template;
  quarter: string;
  revenue: Metric;      // lender: net interest income
  ebitda: Metric;       // lender: pre-provision operating profit
  pbt: Metric;
  pat: Metric;          // owners' share when reported
  ebitda_margin: { value: number | null; qoq_bps: number | null; yoy_bps: number | null };
  pat_margin: number | null;
  exceptional: number | null;
  gnpa_pct: number | null;
}

function growth(cur: number | null, base: number | null): number | null {
  if (cur === null || base === null || base === 0) return null;
  // Across a loss a % change is meaningless ("-110% YoY"); the card says "swung to a loss" instead.
  if (base < 0 || cur < 0) return null;
  return round1(((cur - base) / Math.abs(base)) * 100);
}

/** "net loss ₹238 cr against a profit a year ago", "PAT ₹5,202 cr (+32% YoY)". */
export function profitPhrase(m: { value: number | null; yoy: number | null; yoy_pct: number | null }, fmt: { crore: (n: number | null) => string; pct: (n: number | null) => string }, name = "PAT"): string {
  if (m.value === null) return `${name} not stated`;
  if (m.value < 0) {
    const was = m.yoy === null ? "" : m.yoy > 0 ? " against a profit a year ago" : ` (loss ${fmt.crore(Math.abs(m.yoy))} a year ago)`;
    return `net loss ${fmt.crore(Math.abs(m.value))}${was}`;
  }
  if (m.yoy !== null && m.yoy < 0) return `${name} ${fmt.crore(m.value)}, from a loss a year ago`;
  return `${name} ${fmt.crore(m.value)} (${fmt.pct(m.yoy_pct)} YoY)`;
}
function round1(v: number) { return Math.round(v * 10) / 10; }

function metric(cur: number | null, prev: number | null, yoy: number | null): Metric {
  return { value: cur, prev, yoy, qoq_pct: growth(cur, prev), yoy_pct: growth(cur, yoy) };
}

export function computeMetrics(cur: Lines, prev: Lines, yoy: Lines, template: Template): ResultsMetrics {
  const patOf = (l: Lines) => l.pat_owners ?? l.pat_total;
  if (template === "lender") {
    const nii = (l: Lines) => (l.interest_earned !== null && l.interest_expended !== null ? round2(l.interest_earned - l.interest_expended) : null);
    const ppop = (l: Lines) => (l.total_income !== null && l.interest_expended !== null && l.operating_expenses !== null
      ? round2(l.total_income - l.interest_expended - l.operating_expenses) : null);
    return {
      template, quarter: fiscalQuarterLabel(cur.period_end),
      revenue: metric(nii(cur), nii(prev), nii(yoy)),
      ebitda: metric(ppop(cur), ppop(prev), ppop(yoy)),
      pbt: metric(cur.pbt, prev.pbt, yoy.pbt),
      pat: metric(patOf(cur), patOf(prev), patOf(yoy)),
      ebitda_margin: { value: null, qoq_bps: null, yoy_bps: null },
      pat_margin: null,
      exceptional: cur.exceptional,
      gnpa_pct: cur.gnpa_pct,
    };
  }
  const e = [ebitda(cur), ebitda(prev), ebitda(yoy)];
  const m = (eb: number | null, rev: number | null) => (eb !== null && rev ? (eb / rev) * 100 : null);
  const mc = m(e[0], cur.revenue), mp = m(e[1], prev.revenue), my = m(e[2], yoy.revenue);
  const bpsDiff = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round((a - b) * 100) : null);
  return {
    template, quarter: fiscalQuarterLabel(cur.period_end),
    revenue: metric(cur.revenue, prev.revenue, yoy.revenue),
    ebitda: metric(e[0], e[1], e[2]),
    pbt: metric(cur.pbt, prev.pbt, yoy.pbt),
    pat: metric(patOf(cur), patOf(prev), patOf(yoy)),
    ebitda_margin: { value: mc !== null ? round1(mc) : null, qoq_bps: bpsDiff(mc, mp), yoy_bps: bpsDiff(mc, my) },
    pat_margin: cur.revenue ? round1((patOf(cur) / cur.revenue) * 100) : null,
    exceptional: cur.exceptional,
    gnpa_pct: cur.gnpa_pct,
  };
}

export interface Check { name: string; ok: boolean; detail: string }

function near(a: number, b: number, tolPct: number, absTol = 0.6): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= Math.max((tolPct / 100) * scale, absTol);
}

function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Arithmetic and sanity checks on extracted lines (spec 5.4). */
export function runChecks(
  cur: Lines, prev: Lines, yoy: Lines, opts: { expectedPeriodEnd?: string; prevRevenueHint?: number | null; template: Template },
): Check[] {
  const checks: Check[] = [];
  const all = [cur, prev, yoy];
  if (opts.template === "corporate") {
    const ti = all.every((l) => l.total_income === null || l.revenue === null || l.other_income === null
      || near(l.total_income, l.revenue + l.other_income, 0.5));
    checks.push({ name: "total_income", ok: ti, detail: "Total income = revenue + other income" });

    const pre = all.every((l) => {
      if (l.total_income === null || l.total_expenses === null) return true;
      const target = l.pbt_pre_exc ?? l.pbt - (l.exceptional ?? 0) - (l.share_assoc ?? 0);
      return near(target, l.total_income - l.total_expenses, 0.5)
        || near(target - (l.share_assoc ?? 0), l.total_income - l.total_expenses, 0.5);
    });
    checks.push({ name: "pbt_identity", ok: pre, detail: "PBT before exceptional items = total income - total expenses" });
  }
  const pbt = all.every((l) => {
    if (l.pbt_pre_exc === null) return true;
    const ex = l.exceptional ?? 0;
    const sa = l.share_assoc ?? 0;
    return near(l.pbt, l.pbt_pre_exc + ex, 0.5) || near(l.pbt, l.pbt_pre_exc + ex + sa, 0.5);
  });
  checks.push({ name: "exceptional_bridge", ok: pbt, detail: "PBT = PBT before exceptional items + exceptional items" });

  const pat = all.every((l) => {
    if (l.tax === null) return true;
    const sa = l.share_assoc ?? 0;
    return near(l.pat_total, l.pbt - l.tax, 1) || near(l.pat_total, l.pbt - l.tax + sa, 1);
  });
  checks.push({ name: "tax_bridge", ok: pat, detail: "PAT = PBT - tax (allowing share of associates)" });

  if (opts.prevRevenueHint && cur.revenue !== null && opts.template === "corporate") {
    const ratio = cur.revenue / opts.prevRevenueHint;
    checks.push({
      name: "units",
      ok: ratio > 0.3 && ratio < 3,
      detail: `Revenue is ${ratio.toFixed(2)}x the last known quarter (expect 0.3x to 3x)`,
    });
  }

  const dates = [cur.period_end, prev.period_end, yoy.period_end];
  let periodsOk = new Set(dates).size === 3;
  if (opts.expectedPeriodEnd) periodsOk = periodsOk && cur.period_end === opts.expectedPeriodEnd;
  const prevGap = (Date.parse(cur.period_end) - Date.parse(prev.period_end)) / 86_400_000;
  const yoyGap = (Date.parse(cur.period_end) - Date.parse(yoy.period_end)) / 86_400_000;
  periodsOk = periodsOk && prevGap > 80 && prevGap < 100 && yoyGap > 355 && yoyGap < 375;
  checks.push({
    name: "periods",
    ok: periodsOk,
    detail: `Columns ${dates.join(", ")}${opts.expectedPeriodEnd ? `; expected ${opts.expectedPeriodEnd}` : ""}`,
  });
  void addDaysIso;
  return checks;
}

/** Headline for the event row: numbers first, no adjectives. */
export function resultsTitle(m: ResultsMetrics, fmt: { crore: (n: number | null) => string; pct: (n: number | null) => string }): string {
  if (m.template === "lender") {
    return `${m.quarter}: NII ${fmt.crore(m.revenue.value)} (${fmt.pct(m.revenue.yoy_pct)} YoY), ${profitPhrase(m.pat, fmt)}`;
  }
  return `${m.quarter}: revenue ${fmt.crore(m.revenue.value)} (${fmt.pct(m.revenue.yoy_pct)} YoY), ${profitPhrase(m.pat, fmt)}`;
}

export const RESULTS_PROMPT = (company: string, periodEnd: string, prefer: string, lender: boolean, candidates = 0) => [
  `These pages hold the financial results of ${company} for the quarter ended ${periodEnd}.`,
  candidates > 1 ? `You were sent ${candidates} candidate pages from a scanned filing; read the figures from the page images, not any text layer. Use the ${prefer} statement if present, otherwise the other one, and set statement_page to its position (1 to ${candidates}) among the pages sent.` : "",
  `Extract the ${prefer} statement of profit and loss, using three columns only: the current quarter, the immediately preceding quarter, and the same quarter last year.`,
  "Ignore half-year, nine-month and full-year columns. Report the unit printed on the page (for example 'Rs in crore' or 'Rs in lakhs').",
  "Line mapping: revenue_from_operations = 'Revenue from operations' (never 'Total income'); total_expenses = 'Total expenses';",
  "profit_before_exceptional_and_tax = profit before exceptional items and tax; profit_before_tax = after exceptional items;",
  "profit_after_tax_total = 'Profit for the period'; profit_after_tax_owners = the share attributable to owners or equity holders of the parent.",
  "Use negative numbers for losses and for amounts shown in brackets. Use period_end dates as YYYY-MM-DD.",
  lender ? "This is a bank or NBFC: also fill interest_earned (total interest income), interest_expended (interest or finance cost on borrowings and deposits), operating_expenses, provisions (and contingencies or impairment on financial instruments) and gross_npa_pct when printed." : "",
].filter(Boolean).join("\n");
