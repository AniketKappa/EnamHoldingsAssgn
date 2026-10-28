// Shapes the web API returns. Imported by client components, so no server code here.
export type Tier = "top" | "worth" | "routine" | "hidden";

export interface MetricT { value: number | null; prev: number | null; yoy: number | null; qoq_pct: number | null; yoy_pct: number | null }
export interface ResultsCardT {
  quarter: string;
  period_end: string;
  basis: "consolidated" | "standalone";
  template: "corporate" | "lender";
  unit: string;
  metrics: {
    revenue: MetricT; ebitda: MetricT; pbt: MetricT; pat: MetricT;
    ebitda_margin: { value: number | null; qoq_bps: number | null; yoy_bps: number | null };
    pat_margin: number | null; exceptional: number | null; gnpa_pct: number | null;
  };
  checks: { name: string; ok: boolean; detail: string }[];
  checks_ok: boolean;
  unreliable: boolean;
  source_pages: number[];
  pdf_url: string | null;
  verified: "match" | "mismatch" | null;
  verified_detail?: { source: string; url: string; column: string; rows: { line: string; ours: number | null; theirs: number | null; ok: boolean | null }[] };
  note: string | null;
}

export interface PersonT {
  person_name: string;
  designation: string;
  role_class: string;
  change_type: string;
  effective_date: string | null;
  reason: string | null;
  brief_profile: string | null;
  relationships: string | null;
  flags: string[];
  background: {
    headline: string | null;
    previous_roles: { organisation: string; title: string; start_year: number | null; end_year: number | null; source_url: string }[];
    education: string[];
    years_experience: number | null;
    linkedin_url: string | null;
    sources: { title: string; url: string }[];
    via: string;
  } | null;
}

export interface BriefItem {
  key: string;
  symbol: string;
  company: string;
  category: string;
  subtype: string | null;
  title: string;
  at: string;
  filings: number;
  score: number;
  tier: Tier;
  reasons: string[];
  red_flags: string[];
  kind: "results" | "person" | "guidance" | "generic";
  results?: ResultsCardT;
  people?: PersonT[];
  primary_index?: number;
  one_liner?: string | null;
  amount_cr?: number | null;
  pdf_url: string | null;
  status: string;
  done: boolean;
  weight_pct: number | null;
  market?: { d: string; ret_pct: number | null; vol_ratio: number | null } | null;
  guidance?: { metric: string; horizon: string; from: string; to: string; cite: string; quote: string };
}

export interface BriefT {
  window: { key: string; from: string; to: string; label: string };
  funnel: { filings: number; events: number; matter: number };
  top: BriefItem[];
  worth: BriefItem[];
  routine: { count: number; items: { key: string; symbol: string; title: string; at: string }[] };
  hidden_count: number;
  quiet: { last_material: { symbol: string; title: string; at: string } | null } | null;
  upcoming: { symbol: string; name: string; date: string }[];
  holdings: number;
  freshness: { filings_checked_at: string | null; prices_at: string | null; delayed: boolean };
  caught_up: boolean;
  configured: { llm: boolean };
}

export interface FilingT { id: string; subject: string; headline: string | null; at: string; category: string | null; subtype: string | null; pdf_url: string | null; view_url: string | null; is_primary: boolean; one_liner: string | null }

export interface EventDetailT {
  item: BriefItem;
  filings: FilingT[];
  error: string | null;
  feedback: string[];
  signal: { d: string; ret_pct: number | null; vol_ratio: number | null; ret_z: number | null } | null;
  how: string;
}

export interface AlertT { id: number; symbol: string | null; kind: "event" | "signal"; title: string; body: string | null; url: string | null; at: string; read: boolean; rule: string | null }
export interface RuleT { id: number; kind: "category" | "price_move" | "volume_spike" | "sigma_move"; symbol: string | null; params: Record<string, unknown>; label: string; source_text: string | null; enabled: boolean }

export interface HoldingT {
  symbol: string; name: string; sector: string | null; weight_pct: number | null;
  last_close: number | null; last_d: string | null; ret_pct: number | null; vol_ratio: number | null;
  latest: { key: string; title: string; at: string; tier: Tier } | null;
  backfilling: boolean;
  spark: number[];
}

export interface CompanyT {
  symbol: string; name: string; sector: string | null; mcap_cr: number | null; is_financial: boolean; held: boolean;
  prices: { d: string; close: number; volume: number }[];
  events: { key: string; title: string; at: string; category: string; tier: Tier; score: number }[];
  upcoming: string | null;
  dossier: { version: string; built_at: string } | null;
  signal: { d: string; ret_pct: number | null; vol_ratio: number | null; explained_by: string | null } | null;
}

export interface JobT { id: string; kind: string; symbol: string | null; status: "queued" | "running" | "done" | "failed"; step: string | null; progress: number; log: { at: string; text: string }[]; error: string | null; version: string | null }
