// The stored Dossier (DossierV1). Assembled by code, never by a model: model
// output only fills the cited bullet lists, after validation.
import type { Credibility, Status } from "./ledger";
import type { Fact, Series } from "./facts";

export interface Cited { text: string; cites: string[] }

export interface DossierDoc {
  id: number;
  type: "transcript" | "presentation" | "annual_report";
  label: string;
  period_label: string;
  url: string;
  pages: number;
  used_pages?: number[];
}

export interface LedgerRow {
  id: number;
  call: string;            // "Q1 FY27 call"
  said_on: string;
  metric: string;
  metric_label: string;
  label_raw: string;
  target_text: string;
  horizon: string;
  basis: string;
  status: Status;
  actual: { value: number; unit: string; label: string; cite: string } | null;
  revised_to: { text: string; said_period: string; cite: string } | null;
  note: string | null;
  quote: string;
  cite: string;            // doc:<id>:p<n>
  speaker: string | null;
}

export interface Judged { id: number; claim: string; quote: string; cite: string; verdict: "agree" | "diverge" | "too_early"; evidence: string; cites: string[] }

export interface DossierV1 {
  version: 1;
  symbol: string;
  name: string;
  built_at: string;
  basis: "consolidated" | "standalone";
  lender: boolean;
  sector: string | null;
  header: { price: number | null; mcap_cr: number | null; pe: number | null; roe: number | null; roce: number | null; screener_url: string };
  documents: DossierDoc[];
  what_matters_now: Cited[];
  bull: Cited[];
  bear: Cited[];
  seed_questions: string[];
  say_vs_do: { credibility: Credibility; items: LedgerRow[]; note: string | null };
  narrative_vs_numbers: Judged[];
  numbers: {
    tiles: { key: string; label: string; value: number; unit: string; period: string; change?: { value: number; unit: string; label: string } }[];
    annual: Record<string, Series>;
    quarterly: Record<string, Series>;
    cagr: { key: string; label: string; y3: number | null; y5: number | null }[];
  };
  cash: { cfo_pat_5y: number | null; cfo_ebitda: number | null; fcf: number | null; flag: string | null };
  balance_sheet: {
    borrowings: number | null; de_ratio: number | null; interest_cover: number | null; net_worth: number | null;
    wc_days: { debtor: number | null; inventory: number | null; payable: number | null; ccc: number | null };
    contingent_cr: number | null; contingent_pct_networth: number | null;
    auditor_opinion: string | null; key_audit_matters: string[];
    cites: Record<string, string>;
  };
  business: { description: string | null; segments: { name: string; revenue_cr: number | null; share_pct: number | null; cite: string | null }[]; risks: string[]; related_party: string[]; cites: Record<string, string> };
  analyst_concerns: { topic: string; summary: string; cite: string }[];
  facts: Record<string, Fact>;
  flags: string[];
  pending: string[];
  stats: { calls: number; cached_calls: number; tokens_in: number; tokens_out: number; cost_usd_est: number; seconds: number; dropped_bullets: number };
}

export const METRIC_LABEL: Record<string, string> = {
  revenue_growth: "Revenue growth", revenue: "Revenue", ebitda_margin: "EBITDA margin", ebit_margin: "EBIT margin", ebitda: "EBITDA",
  pat_growth: "Profit growth", pat: "Net profit", capex: "Capex", net_debt: "Net debt", order_inflow: "Order inflow",
  order_inflow_growth: "Order inflow growth", order_book: "Order book", volume_growth: "Volume growth", aum_growth: "AUM growth",
  credit_cost: "Credit cost", nim: "Net interest margin", gnpa: "Gross NPA", capacity: "Capacity", store_count: "Store count",
};

export function metricLabel(m: string): string {
  if (METRIC_LABEL[m]) return METRIC_LABEL[m];
  const o = m.replace(/^other:/, "").replace(/_/g, " ");
  return o.charAt(0).toUpperCase() + o.slice(1);
}
