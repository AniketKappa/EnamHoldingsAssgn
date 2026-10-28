// Financial facts, computed in code from screener's standardised tables
// (spec 6.4). Every fact keeps the table, row and column it came from, so the
// Dossier can cite "Screener consolidated P&L, Mar 2026".
import type { ScreenerCompany, ScreenerTable } from "../sources/screener";
import { fiscalYearLabel, fiscalQuarterLabel } from "../time";

export type Unit = "cr" | "pct" | "x" | "days" | "rs" | "bps";

export interface Fact {
  key: string;
  label: string;
  value: number;
  unit: Unit;
  period: string;     // "Q2 FY27", "FY26", "5 years to FY26", "now"
  source: string;     // human-readable citation
}

export interface Series { labels: string[]; values: (number | null)[] }

export interface FactsBundle {
  basis: "consolidated" | "standalone";
  lender: boolean;
  facts: Record<string, Fact>;
  annual: Record<string, Series>;     // revenue, ebitda, opm, pat, roce, cfo, fcf, borrowings
  quarterly: Record<string, Series>;  // revenue, ebitda, opm, pat
  flags: string[];
  latestQuarter: string | null;
  latestYear: string | null;
  url: string;
}

const STATEMENT_NAME: Record<string, string> = {
  quarters: "quarterly results", profit_loss: "P&L", balance_sheet: "balance sheet", cash_flow: "cash flow", ratios: "ratios", top: "header",
};

function round(v: number, d = 1) { const f = 10 ** d; return Math.round(v * f) / f; }

/** Columns with a date (drops TTM), oldest first. */
function dated(t: ScreenerTable | undefined): { idx: number; label: string; date: string }[] {
  if (!t) return [];
  return t.periods.map((p, idx) => ({ idx, label: p.label, date: p.date ?? "" })).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date));
}

function row(t: ScreenerTable | undefined, key: string): (number | null)[] | null {
  return t?.rows.find((r) => r.key === key)?.values ?? null;
}

export function cagr(first: number | null, last: number | null, years: number): number | null {
  if (first === null || last === null || first <= 0 || last <= 0 || years <= 0) return null;
  return round((Math.pow(last / first, 1 / years) - 1) * 100, 1);
}

export function computeFacts(sc: ScreenerCompany): FactsBundle {
  const facts: Record<string, Fact> = {};
  const basisName = sc.basis === "consolidated" ? "Screener consolidated" : "Screener standalone";
  const add = (key: string, label: string, value: number | null | undefined, unit: Unit, period: string, statement: string, column: string) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    facts[key] = { key, label, value, unit, period, source: `${basisName} ${STATEMENT_NAME[statement] ?? statement}, ${column}` };
  };
  const q = sc.tables.quarters, pl = sc.tables.profit_loss, bs = sc.tables.balance_sheet, cf = sc.tables.cash_flow, ra = sc.tables.ratios;
  const lender = !!(q?.rows.some((r) => r.key === "financing_profit") || bs?.rows.some((r) => r.key === "deposits"));

  // Quarterly series and the latest quarter.
  const qd = dated(q);
  const qRev = row(q, "revenue"), qEb = row(q, lender ? "financing_profit" : "ebitda"), qPat = row(q, "pat"), qPbt = row(q, "pbt"), qInt = row(q, "interest");
  const qLabels = qd.map((p) => fiscalQuarterLabel(p.date));
  const qOpm = qd.map((p) => (qRev?.[p.idx] && qEb?.[p.idx] !== null && qEb?.[p.idx] !== undefined ? round((qEb![p.idx]! / qRev![p.idx]!) * 100, 1) : null));
  const quarterly: Record<string, Series> = {
    revenue: { labels: qLabels, values: qd.map((p) => qRev?.[p.idx] ?? null) },
    ebitda: { labels: qLabels, values: qd.map((p) => qEb?.[p.idx] ?? null) },
    opm: { labels: qLabels, values: qOpm },
    pat: { labels: qLabels, values: qd.map((p) => qPat?.[p.idx] ?? null) },
  };
  let latestQuarter: string | null = null;
  if (qd.length) {
    const last = qd[qd.length - 1];
    const yoyCol = qd.length >= 5 ? qd[qd.length - 5] : null;
    latestQuarter = fiscalQuarterLabel(last.date);
    const col = `${last.label} column`;
    add("q_revenue", lender ? "Revenue (interest earned)" : "Revenue", qRev?.[last.idx], "cr", latestQuarter, "quarters", col);
    if (lender && qRev?.[last.idx] !== undefined && qInt?.[last.idx] !== undefined && qRev?.[last.idx] !== null && qInt?.[last.idx] !== null) {
      add("q_nii", "Net interest income", round(qRev![last.idx]! - qInt![last.idx]!, 0), "cr", latestQuarter, "quarters", col);
    }
    add("q_ebitda", lender ? "Financing profit" : "EBITDA", qEb?.[last.idx], "cr", latestQuarter, "quarters", col);
    if (!lender) add("q_opm", "EBITDA margin", qOpm[qd.length - 1], "pct", latestQuarter, "quarters", col);
    add("q_pbt", "Profit before tax", qPbt?.[last.idx], "cr", latestQuarter, "quarters", col);
    add("q_pat", "Net profit", qPat?.[last.idx], "cr", latestQuarter, "quarters", col);
    if (yoyCol) {
      const g = (a: number | null | undefined, b: number | null | undefined) => (a !== null && a !== undefined && b ? round(((a - b) / Math.abs(b)) * 100, 1) : null);
      add("q_revenue_yoy", "Revenue growth YoY", g(qRev?.[last.idx], qRev?.[yoyCol.idx]), "pct", latestQuarter, "quarters", `${last.label} vs ${yoyCol.label}`);
      add("q_pat_yoy", "Net profit growth YoY", g(qPat?.[last.idx], qPat?.[yoyCol.idx]), "pct", latestQuarter, "quarters", `${last.label} vs ${yoyCol.label}`);
      const raw = (col: { idx: number }) => (qRev?.[col.idx] && qEb?.[col.idx] !== null && qEb?.[col.idx] !== undefined ? (qEb![col.idx]! / qRev![col.idx]!) * 100 : null);
      const m0 = raw(last), m1 = raw(yoyCol);
      if (!lender && m0 !== null && m1 !== null) add("q_opm_yoy_bps", "EBITDA margin change YoY", Math.round((m0 - m1) * 100), "bps", latestQuarter, "quarters", `${last.label} vs ${yoyCol.label}`);
    }
  }

  // Annual series (fiscal years), latest full year and growth rates.
  const yd = dated(pl);
  const aRev = row(pl, "revenue"), aEb = row(pl, lender ? "financing_profit" : "ebitda"), aPat = row(pl, "pat"), aPbt = row(pl, "pbt"), aInt = row(pl, "interest");
  const yLabels = yd.map((p) => fiscalYearLabel(p.date));
  const aOpm = yd.map((p) => (aRev?.[p.idx] && aEb?.[p.idx] !== null && aEb?.[p.idx] !== undefined ? round((aEb![p.idx]! / aRev![p.idx]!) * 100, 1) : null));
  const rd = dated(ra);
  const roce = row(ra, "roce_pct");
  const cd = dated(cf);
  const cfo = row(cf, "cfo"), fcf = row(cf, "fcf"), cfoEb = row(cf, "cfo_ebitda_pct");
  const annual: Record<string, Series> = {
    revenue: { labels: yLabels, values: yd.map((p) => aRev?.[p.idx] ?? null) },
    ebitda: { labels: yLabels, values: yd.map((p) => aEb?.[p.idx] ?? null) },
    opm: { labels: yLabels, values: aOpm },
    pat: { labels: yLabels, values: yd.map((p) => aPat?.[p.idx] ?? null) },
    roce: { labels: rd.map((p) => fiscalYearLabel(p.date)), values: rd.map((p) => roce?.[p.idx] ?? null) },
    cfo: { labels: cd.map((p) => fiscalYearLabel(p.date)), values: cd.map((p) => cfo?.[p.idx] ?? null) },
    fcf: { labels: cd.map((p) => fiscalYearLabel(p.date)), values: cd.map((p) => fcf?.[p.idx] ?? null) },
  };
  let latestYear: string | null = null;
  if (yd.length) {
    const n = yd.length - 1;
    const last = yd[n];
    latestYear = fiscalYearLabel(last.date);
    const col = `${last.label} column`;
    add("fy_revenue", "Revenue", aRev?.[last.idx], "cr", latestYear, "profit_loss", col);
    add("fy_ebitda", lender ? "Financing profit" : "EBITDA", aEb?.[last.idx], "cr", latestYear, "profit_loss", col);
    if (!lender) add("fy_opm", "EBITDA margin", aOpm[n], "pct", latestYear, "profit_loss", col);
    add("fy_pat", "Net profit", aPat?.[last.idx], "cr", latestYear, "profit_loss", col);
    if (n >= 1) {
      const prev = yd[n - 1];
      const g = (a?: number | null, b?: number | null) => (a !== null && a !== undefined && b ? round(((a - b) / Math.abs(b)) * 100, 1) : null);
      add("fy_revenue_growth", "Revenue growth", g(aRev?.[last.idx], aRev?.[prev.idx]), "pct", latestYear, "profit_loss", `${last.label} vs ${prev.label}`);
      add("fy_pat_growth", "Net profit growth", g(aPat?.[last.idx], aPat?.[prev.idx]), "pct", latestYear, "profit_loss", `${last.label} vs ${prev.label}`);
    }
    for (const yrs of [3, 5]) {
      if (n >= yrs) {
        const first = yd[n - yrs];
        const span = `${yrs} years to ${latestYear}`;
        const col2 = `${first.label} to ${last.label}`;
        add(`revenue_cagr_${yrs}y`, `Revenue CAGR, ${yrs} years`, cagr(aRev?.[first.idx] ?? null, aRev?.[last.idx] ?? null, yrs), "pct", span, "profit_loss", col2);
        add(`ebitda_cagr_${yrs}y`, `${lender ? "Financing profit" : "EBITDA"} CAGR, ${yrs} years`, cagr(aEb?.[first.idx] ?? null, aEb?.[last.idx] ?? null, yrs), "pct", span, "profit_loss", col2);
        add(`pat_cagr_${yrs}y`, `Net profit CAGR, ${yrs} years`, cagr(aPat?.[first.idx] ?? null, aPat?.[last.idx] ?? null, yrs), "pct", span, "profit_loss", col2);
      }
    }
    const pbt = aPbt?.[last.idx], intr = aInt?.[last.idx];
    if (!lender && pbt !== null && pbt !== undefined && intr) add("interest_cover", "Interest cover", round((pbt + intr) / intr, 1), "x", latestYear, "profit_loss", `${col}: (PBT + interest) / interest`);
  }
  if (rd.length) {
    const last = rd[rd.length - 1];
    add("roce", "ROCE", roce?.[last.idx], "pct", fiscalYearLabel(last.date), "ratios", `${last.label} column`);
    if (!lender) {
      for (const [key, label] of [["debtor_days", "Debtor days"], ["inventory_days", "Inventory days"], ["days_payable", "Days payable"], ["ccc_days", "Cash conversion cycle"]] as const) {
        add(key, label, row(ra, key)?.[last.idx], "days", fiscalYearLabel(last.date), "ratios", `${last.label} column`);
      }
    }
  }
  add("roe", "ROE", sc.top.roe_pct, "pct", "now", "top", "header ratios");
  add("mcap", "Market cap", sc.top.market_cap_cr, "cr", "now", "top", "header ratios");
  add("price", "Price", sc.top.price, "rs", "now", "top", "header ratios");
  add("pe", "P/E", sc.top.pe, "x", "now", "top", "header ratios");

  // Balance sheet: the latest column (may be a half-year), annual borrowings series.
  const bd = dated(bs);
  if (bd.length) {
    const last = bd[bd.length - 1];
    const eq = row(bs, "equity_capital")?.[last.idx] ?? null, res = row(bs, "reserves")?.[last.idx] ?? null;
    const borrow = row(bs, lender ? "borrowings" : "borrowings")?.[last.idx] ?? null;
    const period = last.label;
    add("borrowings", "Borrowings", borrow, "cr", period, "balance_sheet", `${last.label} column`);
    if (eq !== null && res !== null) {
      add("net_worth", "Net worth", eq + res, "cr", period, "balance_sheet", `${last.label} column: equity + reserves`);
      if (borrow !== null && eq + res > 0) add("de_ratio", "Debt to equity", round(borrow / (eq + res), 2), "x", period, "balance_sheet", `${last.label} column: borrowings / (equity + reserves)`);
    }
    if (lender) add("deposits", "Deposits", row(bs, "deposits")?.[last.idx], "cr", period, "balance_sheet", `${last.label} column`);
    annual.borrowings = { labels: bd.map((p) => p.label), values: bd.map((p) => row(bs, "borrowings")?.[p.idx] ?? null) };
  }

  // Cash quality.
  const flags: string[] = [];
  if (cd.length) {
    const last = cd[cd.length - 1];
    const fy = fiscalYearLabel(last.date);
    add("cfo", "Cash from operations", cfo?.[last.idx], "cr", fy, "cash_flow", `${last.label} column`);
    add("fcf", "Free cash flow", fcf?.[last.idx], "cr", fy, "cash_flow", `${last.label} column`);
    add("cfo_ebitda", "CFO / EBITDA", cfoEb?.[last.idx], "pct", fy, "cash_flow", `${last.label} column`);
    if (cd.length >= 5 && yd.length >= 5) {
      const lastFive = cd.slice(-5);
      const cfoSum = lastFive.reduce((s, p) => s + (cfo?.[p.idx] ?? 0), 0);
      let patSum = 0, ok = true;
      for (const p of lastFive) {
        const ycol = yd.find((y) => y.date === p.date);
        const v = ycol ? aPat?.[ycol.idx] : null;
        if (v === null || v === undefined) { ok = false; break; }
        patSum += v;
      }
      if (ok && patSum > 0) {
        const ratio = round(cfoSum / patSum, 2);
        add("cfo_pat_5y", "CFO / PAT, 5 years", ratio, "x", `5 years to ${fy}`, "cash_flow", `${lastFive[0].label} to ${last.label}, cumulative`);
        add("cfo_5y", "Cash from operations, 5 years", cfoSum, "cr", `5 years to ${fy}`, "cash_flow", `${lastFive[0].label} to ${last.label}, cumulative`);
        add("pat_5y", "Net profit, 5 years", patSum, "cr", `5 years to ${fy}`, "profit_loss", `${lastFive[0].label} to ${last.label}, cumulative`);
        if (!lender && ratio < 0.7) flags.push("Profits are not turning into cash");
      }
    }
  }
  return { basis: sc.basis, lender, facts, annual, quarterly, flags, latestQuarter, latestYear, url: sc.url };
}

/** Value of a series at a label ("FY26", "Q2 FY27"), or null. */
export function at(s: Series | undefined, label: string): number | null {
  if (!s) return null;
  const i = s.labels.indexOf(label);
  return i >= 0 ? s.values[i] ?? null : null;
}
