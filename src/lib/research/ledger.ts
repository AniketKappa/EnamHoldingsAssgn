// The Say-vs-Do ledger (spec 6.5): every numeric promise management made in
// the last calls, matched by code against what the tables or later calls show.
// Statuses are deterministic; the model never decides whether a promise was kept.
import type { FactsBundle, Series } from "./facts";
import { at } from "./facts";
import { parseHorizon, quartersOf, yearEarlier, normalizePeriod, type Horizon } from "./horizon";

export type Status = "delivered" | "near_miss" | "missed" | "on_track" | "off_track" | "revised" | "pending" | "unverifiable" | "basis_differs";

export interface GuidanceIn {
  id: number;
  doc_id: number;
  said_period: string;     // the call: "Q1 FY27"
  said_on: string;         // YYYY-MM-DD (approximate for screener's month labels)
  metric: string;
  label_raw: string;
  target_low: number | null;
  target_high: number | null;
  unit: "pct" | "cr" | "bps" | "count" | "x" | "other";
  basis: "reported" | "constant_currency" | "organic" | "ex_one_offs" | "unspecified";
  horizon: string;
  direction: "range" | "at_least" | "at_most" | "point" | "qualitative";
  speaker: string | null;
  quote: string;
  page: number;
}

export interface KpiIn {
  doc_id: number; said_on: string; metric: string; value: number; unit: string; basis?: string | null; period: string; quote: string; page: number;
}

export interface Actual { value: number; unit: string; label: string; cite: string; partial: boolean }

export interface LedgerItem extends GuidanceIn {
  horizon_label: string;
  status: Status;
  actual: Actual | null;
  revised_to: { low: number | null; high: number | null; said_period: string; doc_id: number; page: number } | null;
  note: string | null;
  counts: boolean;         // included in the credibility score
}

export interface Credibility { delivered: number; near_miss: number; missed: number; resolved: number; pending: number; score: number | null }

const LOWER_BETTER = new Set(["credit_cost", "gnpa", "net_debt", "other:net_debt", "other:gross_npa"]);
const NEUTRAL = new Set(["capex"]);
const TABLE_RATES = new Set(["revenue_growth", "pat_growth", "ebitda_margin"]);
const TABLE_VALUES = new Set(["revenue", "ebitda", "pat"]);

function round(v: number, d = 1) { const f = 10 ** d; return Math.round(v * f) / f; }

export function targetText(g: Pick<GuidanceIn, "target_low" | "target_high" | "unit" | "direction">): string {
  const u = (v: number) => g.unit === "pct" ? `${v}%` : g.unit === "bps" ? `${v} bps` : g.unit === "cr" ? `₹${v.toLocaleString("en-IN")} cr` : g.unit === "x" ? `${v}×` : `${v}`;
  const lo = g.target_low, hi = g.target_high;
  if (g.direction === "qualitative" || (lo === null && hi === null)) return "Qualitative";
  if (g.direction === "at_least") return `At least ${u((lo ?? hi)!)}`;
  if (g.direction === "at_most") return `At most ${u((hi ?? lo)!)}`;
  if (lo !== null && hi !== null && lo !== hi) return g.unit === "pct" ? `${lo}–${hi}%` : `${u(lo)} to ${u(hi)}`;
  return u((lo ?? hi)!);
}

/** Sum a series over quarter labels; null unless every quarter is present. */
function sumOver(s: Series | undefined, quarters: string[]): number | null {
  let total = 0;
  for (const q of quarters) {
    const v = at(s, q);
    if (v === null) return null;
    total += v;
  }
  return quarters.length ? total : null;
}

/** The actual for a guidance item from the tables, or null. `partial` marks a period still in progress. */
export function tableActual(metric: string, h: Horizon, f: FactsBundle): Actual | null {
  if (!(TABLE_RATES.has(metric) || TABLE_VALUES.has(metric))) return null;
  if (h.kind !== "fy" && h.kind !== "quarter" && h.kind !== "half") return null;
  const all = quartersOf(h);
  const have = all.filter((q) => at(f.quarterly.revenue, q) !== null);
  if (!have.length) {
    // A complete fiscal year may exist in the annual table even when the quarters have scrolled off.
    if (h.kind === "fy" && at(f.annual.revenue, h.label) !== null) return annualActual(metric, h, f);
    return null;
  }
  const partial = have.length < all.length;
  if (h.kind === "fy" && !partial && at(f.annual.revenue, h.label) !== null) return annualActual(metric, h, f);
  const qs = have;
  const prior = qs.map(yearEarlier);
  const fyOf = (q: string) => q.split(" ")[1];
  const span = qs.length === 1 ? qs[0]
    : fyOf(qs[0]) === fyOf(qs[qs.length - 1]) ? `${qs[0].split(" ")[0]}–${qs[qs.length - 1].split(" ")[0]} ${fyOf(qs[0])}` : `${qs[0]} to ${qs[qs.length - 1]}`;
  const src = `fact:quarters:${qs.join(",")}`;
  const sum = (k: string, list: string[]) => sumOver(f.quarterly[k], list);
  switch (metric) {
    case "revenue_growth":
    case "pat_growth": {
      const key = metric === "revenue_growth" ? "revenue" : "pat";
      const a = sum(key, qs), b = sum(key, prior);
      if (a === null || b === null || b <= 0) return null;
      return { value: round(((a - b) / b) * 100), unit: "pct", label: `${span} vs a year earlier${partial ? ", so far" : ""}`, cite: src, partial };
    }
    case "ebitda_margin": {
      const e = sum("ebitda", qs), r = sum("revenue", qs);
      if (e === null || r === null || r <= 0) return null;
      return { value: round((e / r) * 100), unit: "pct", label: span, cite: src, partial };
    }
    case "revenue": case "ebitda": case "pat": {
      if (partial) return null; // absolute targets are judged on the full period only
      const v = sum(metric, qs);
      return v === null ? null : { value: round(v, 0), unit: "cr", label: span, cite: src, partial };
    }
  }
  return null;
}

function annualActual(metric: string, h: Horizon, f: FactsBundle): Actual | null {
  const fy = h.label;
  const prevFy = `FY${String(((h.fy ?? 0) - 1) % 100).padStart(2, "0")}`;
  const cite = `fact:annual:${fy}`;
  switch (metric) {
    case "revenue_growth": case "pat_growth": {
      const k = metric === "revenue_growth" ? "revenue" : "pat";
      const a = at(f.annual[k], fy), b = at(f.annual[k], prevFy);
      if (a === null || b === null || b <= 0) return null;
      return { value: round(((a - b) / b) * 100), unit: "pct", label: `${fy} vs ${prevFy}`, cite, partial: false };
    }
    case "ebitda_margin": {
      const e = at(f.annual.ebitda, fy), r = at(f.annual.revenue, fy);
      if (e === null || r === null || r <= 0) return null;
      return { value: round((e / r) * 100), unit: "pct", label: fy, cite, partial: false };
    }
    case "revenue": case "ebitda": case "pat": {
      const v = at(f.annual[metric], fy);
      return v === null ? null : { value: v, unit: "cr", label: fy, cite, partial: false };
    }
  }
  return null;
}

export function kpiActual(g: GuidanceIn, h: Horizon, kpis: KpiIn[]): Actual | null {
  const want = h.label;
  const hits = kpis
    .filter((k) => k.metric === g.metric && sameUnit(k.unit, g.unit) && normalizePeriod(k.period) === want && k.said_on > g.said_on)
    .filter((k) => g.basis === "reported" || g.basis === "unspecified" ? !k.basis || k.basis === "reported" || k.basis === "unspecified" : k.basis === g.basis)
    .sort((a, b) => b.said_on.localeCompare(a.said_on));
  const k = hits[0];
  if (!k) return null;
  return { value: k.value, unit: g.unit, label: want, cite: `doc:${k.doc_id}:p${k.page}`, partial: false };
}

function sameUnit(a: string, b: string) {
  const n = (u: string) => (/^%|pct|percent/i.test(u) ? "pct" : /cr|crore/i.test(u) ? "cr" : /bps|basis/i.test(u) ? "bps" : u.toLowerCase());
  return n(a) === n(b);
}

/** Delivered, near miss or missed for a finished period (spec 6.5 bands). */
export function judge(g: Pick<GuidanceIn, "metric" | "target_low" | "target_high" | "unit" | "direction">, actual: number): "delivered" | "near_miss" | "missed" {
  const lo = g.target_low, hi = g.target_high;
  const lowerBetter = LOWER_BETTER.has(g.metric);
  const ref = (lo ?? hi)!;
  const band = g.unit === "pct" ? 1 : g.unit === "bps" ? 50 : Math.abs(ref) * 0.05;
  if (NEUTRAL.has(g.metric) && (g.direction === "point" || g.direction === "range")) {
    const lo2 = lo ?? hi!, hi2 = hi ?? lo!;
    if (actual >= lo2 * 0.9 && actual <= hi2 * 1.1) return "delivered";
    if (actual >= lo2 * 0.8 && actual <= hi2 * 1.2) return "near_miss";
    return "missed";
  }
  const atMost = g.direction === "at_most" || (lowerBetter && g.direction !== "at_least");
  if (atMost) {
    const cap = (g.direction === "range" ? hi ?? lo : hi ?? lo)!;
    if (actual <= cap) return "delivered";
    if (actual <= cap + band) return "near_miss";
    return "missed";
  }
  const floor = (g.direction === "range" ? lo ?? hi : lo ?? hi)!;
  if (actual >= floor) return "delivered";
  if (actual >= floor - band) return "near_miss";
  return "missed";
}

function keyOf(g: GuidanceIn, h: Horizon) { return `${g.metric}|${h.label}|${g.basis === "unspecified" ? "reported" : g.basis}`; }

export function buildLedger(guidance: GuidanceIn[], kpis: KpiIn[], f: FactsBundle): { items: LedgerItem[]; credibility: Credibility } {
  const sorted = [...guidance].sort((a, b) => a.said_on.localeCompare(b.said_on) || a.id - b.id);
  const latestByKey = new Map<string, GuidanceIn>();
  for (const g of sorted) {
    if (g.direction === "qualitative" || (g.target_low === null && g.target_high === null)) continue;
    latestByKey.set(keyOf(g, parseHorizon(g.horizon)), g);
  }
  const items: LedgerItem[] = [];
  for (const g of sorted) {
    const h = parseHorizon(g.horizon);
    const base: LedgerItem = { ...g, horizon_label: h.label || g.horizon, status: "unverifiable", actual: null, revised_to: null, note: null, counts: false };
    if (g.direction === "qualitative" || (g.target_low === null && g.target_high === null)) {
      items.push({ ...base, note: "No numeric target" });
      continue;
    }
    const latest = latestByKey.get(keyOf(g, h));
    if (latest && latest !== g) {
      const changed = latest.target_low !== g.target_low || latest.target_high !== g.target_high;
      if (changed) {
        items.push({ ...base, status: "revised", revised_to: { low: latest.target_low, high: latest.target_high, said_period: latest.said_period, doc_id: latest.doc_id, page: latest.page } });
      }
      // A reiterated target is shown once, at its latest statement.
      continue;
    }
    if (h.kind === "multi" || h.kind === "unknown") {
      items.push({ ...base, status: "pending", note: "Multi-year target" });
      continue;
    }
    const tableOk = g.basis === "reported" || g.basis === "unspecified";
    let actual = tableOk ? tableActual(g.metric, h, f) : null;
    if (!actual || actual.partial) {
      const k = kpiActual(g, h, kpis);
      if (k) actual = k;
    }
    if (!actual) {
      const qs = quartersOf(h);
      const have = qs.filter((q) => at(f.quarterly.revenue, q) !== null).length;
      const complete = (have > 0 && have === qs.length) || (h.kind === "fy" && at(f.annual.revenue, h.label) !== null);
      if (!tableOk && (TABLE_RATES.has(g.metric) || TABLE_VALUES.has(g.metric))) {
        items.push({ ...base, status: "basis_differs", note: `Guided on a ${g.basis.replace("_", " ")} basis; reported numbers differ` });
      } else if (complete) {
        items.push({ ...base, status: "unverifiable", note: "No actual in the documents" });
      } else {
        items.push({ ...base, status: "pending", note: have ? "Period in progress; no actual stated yet" : "Period not started" });
      }
      continue;
    }
    if (actual.partial) {
      const j = judge(g, actual.value);
      items.push({ ...base, actual, status: j === "missed" ? "off_track" : "on_track" });
      continue;
    }
    const status = judge(g, actual.value);
    items.push({ ...base, actual, status, counts: true });
  }
  const c = { delivered: 0, near_miss: 0, missed: 0, pending: 0 };
  for (const it of items) {
    if (it.counts && (it.status === "delivered" || it.status === "near_miss" || it.status === "missed")) c[it.status]++;
    if (it.status === "pending" || it.status === "on_track" || it.status === "off_track") c.pending++;
  }
  const resolved = c.delivered + c.near_miss + c.missed;
  const score = resolved >= 3 ? Math.round(((c.delivered + 0.5 * c.near_miss) / resolved) * 100) : null;
  // Newest call first for display.
  items.sort((a, b) => b.said_on.localeCompare(a.said_on) || a.id - b.id);
  return { items, credibility: { ...c, resolved, score } };
}
