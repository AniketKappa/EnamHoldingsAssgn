-- FINN schema (Postgres 15+). Apply once: psql "$DATABASE_URL" -f db/schema.sql
-- Global facts (companies, prices, filings, documents) + a per-user lens
-- (holdings, rules, feedback, alerts). Every pipeline stage is idempotent.

-- Global facts -------------------------------------------------------------
create table if not exists companies (
  symbol text primary key,                 -- NSE symbol, e.g. 'LT'
  name text not null,
  isin text,
  bse_code text unique,
  industry text,
  sector text,
  mcap_cr numeric,
  revenue_cr numeric,                      -- latest full-year revenue, for order-size chips
  is_financial boolean not null default false,
  screener_basis text,                     -- consolidated | standalone
  last_close numeric,
  last_close_d date,
  backfilled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists prices (
  symbol text references companies(symbol) on delete cascade,
  d date,
  open numeric, high numeric, low numeric, close numeric, adj_close numeric,
  volume bigint,
  source text not null default 'yahoo',
  primary key (symbol, d)
);

create table if not exists price_signals (
  symbol text references companies(symbol) on delete cascade,
  d date,
  close numeric,
  ret_pct numeric,                         -- 1-day % change
  vol_ratio numeric,                       -- volume / mean of previous 20 sessions
  ret_z numeric,                           -- return / stdev of previous 60 sessions
  explained_by text,                       -- event_key or null
  primary key (symbol, d)
);

create table if not exists announcements (
  id text primary key,                     -- 'BSE:<NEWSID>' or 'NSE:<seq_id>'
  source text not null,                    -- BSE | NSE
  symbol text references companies(symbol) on delete cascade,
  subject text not null,
  headline text,
  exchange_category text,
  exchange_subcategory text,
  filed_at timestamptz not null,
  pdf_url text,
  pdf_bytes int,
  nse_text text,
  raw jsonb not null default '{}',
  category text,
  subtype text,
  classified_by text,                      -- 'rule:<id>' | 'llm' | 'default'
  also jsonb not null default '[]',        -- extra categories in a results filing
  event_key text,
  is_primary boolean not null default true,
  one_liner text,
  amount_cr numeric,
  status text not null default 'new',      -- new | classified | extracted | done | failed
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists announcements_symbol_time on announcements (symbol, filed_at desc);
create index if not exists announcements_event on announcements (event_key);
create index if not exists announcements_status on announcements (status);

-- One row per event (a group of filings). The Brief reads this table.
create table if not exists events (
  event_key text primary key,
  symbol text references companies(symbol) on delete cascade,
  category text not null,
  subtype text,
  title text not null,                     -- one line, numbers first
  primary_id text,                         -- announcements.id of the primary filing
  first_filed_at timestamptz not null,
  last_filed_at timestamptz not null,
  filings int not null default 1,
  base_score int not null default 0,       -- category + governance + size
  market_bonus int not null default 0,     -- added after the end-of-day run
  reasons jsonb not null default '[]',
  red_flags jsonb not null default '[]',
  detail jsonb not null default '{}',      -- card payload: results metrics, people, amounts
  status text not null default 'pending',  -- extraction: pending | done | failed | skipped
  attempts int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);
create index if not exists events_status on events (status);
create index if not exists events_time on events (first_filed_at desc);
create index if not exists events_symbol on events (symbol, first_filed_at desc);

create table if not exists results_extracts (
  announcement_id text primary key references announcements(id) on delete cascade,
  symbol text not null,
  period_end date not null,
  basis text not null,                     -- consolidated | standalone
  template text not null default 'corporate',  -- corporate | lender
  unit_in_doc text,
  periods jsonb not null,                  -- {current, prev_q, yoy_q}: lines in Rs crore
  metrics jsonb not null,                  -- ebitda, margins, qoq/yoy %, bps
  checks jsonb not null,                   -- [{name, ok, detail}]
  verified text,                           -- null | match | mismatch
  verified_detail jsonb,
  source_pages int[],
  model text,
  created_at timestamptz not null default now()
);

create table if not exists people_events (
  id bigserial primary key,
  announcement_id text references announcements(id) on delete cascade,
  symbol text not null,
  person_name text not null,
  designation text,
  role_class text,                         -- top | kmp | independent | auditor | other
  change_type text,
  effective_date date,
  reason text,
  profile_from_filing text,
  relationships text,
  background jsonb,
  flags jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (announcement_id, person_name)
);

create table if not exists upcoming_results (
  symbol text references companies(symbol) on delete cascade,
  meeting_date date,
  fetched_at timestamptz not null default now(),
  primary key (symbol, meeting_date)
);

-- Per-user lens --------------------------------------------------------------
create table if not exists users (
  id text primary key,                     -- 'demo' or the finn_uid cookie value
  settings jsonb not null default '{}',
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists holdings (
  user_id text references users(id) on delete cascade,
  symbol text references companies(symbol) on delete cascade,
  weight_pct numeric,
  thesis text,
  added_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

create table if not exists alert_rules (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  kind text not null,                      -- category | price_move | volume_spike | sigma_move
  symbol text,                             -- null = all holdings
  params jsonb not null,
  label text not null,
  source_text text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  rule_id bigint references alert_rules(id) on delete set null,
  symbol text,
  kind text not null,                      -- event | signal
  ref_id text not null,                    -- event_key or '<symbol>:<date>'
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  unique (user_id, ref_id)
);

create table if not exists push_subscriptions (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  event_key text not null,
  action text not null,                    -- useful | not_useful | mute_category | done
  category text,
  symbol text,
  created_at timestamptz not null default now(),
  unique (user_id, event_key, action)
);

-- Research ------------------------------------------------------------------
create table if not exists documents (
  id bigserial primary key,
  symbol text references companies(symbol) on delete cascade,
  doc_type text not null,                  -- annual_report | transcript | presentation | results
  period_label text,
  period_end date,
  url text not null,
  url_hash text unique not null,
  status text not null default 'new',      -- new | parsed | extracted | failed
  pages int,
  error text,
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists doc_pages (
  document_id bigint references documents(id) on delete cascade,
  page_no int,
  text text not null,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  primary key (document_id, page_no)
);
create index if not exists doc_pages_tsv on doc_pages using gin (tsv);

create table if not exists financials (
  symbol text references companies(symbol) on delete cascade,
  statement text,                          -- quarters | profit_loss | balance_sheet | cash_flow | ratios | top
  basis text,
  period text,
  period_end date,
  line_item text,
  value numeric,
  unit text,
  fetched_at timestamptz not null default now(),
  primary key (symbol, statement, basis, period, line_item)
);

create table if not exists doc_extracts (
  document_id bigint primary key references documents(id) on delete cascade,
  kind text not null,                      -- transcript | annual_report
  data jsonb not null,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists dossiers (
  symbol text references companies(symbol) on delete cascade,
  version text,
  data jsonb not null,
  stats jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (symbol, version)
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                      -- research | backfill
  symbol text,
  user_id text,
  status text not null default 'queued',   -- queued | running | done | failed
  step text,
  progress int not null default 0,
  log jsonb not null default '[]',
  error text,
  result jsonb,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status on jobs (status, created_at);

create table if not exists qa_messages (
  id bigserial primary key,
  symbol text, dossier_version text, user_id text,
  question text not null, answer text not null,
  citations jsonb not null default '[]',
  found boolean not null default true,
  created_at timestamptz not null default now()
);

-- Operations ------------------------------------------------------------------
create table if not exists llm_calls (
  id bigserial primary key,
  task text not null, model text not null, provider text not null,
  tokens_in int, tokens_out int, latency_ms int,
  ok boolean not null, cache_hit boolean not null default false,
  cost_usd_est numeric, error text, ref text,
  created_at timestamptz not null default now()
);
create index if not exists llm_calls_time on llm_calls (created_at desc);

create table if not exists llm_cache (
  key text primary key,
  response jsonb not null,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists http_cache (
  url_hash text primary key,
  url text not null,
  status int,
  body text,
  fetched_at timestamptz not null default now()
);

create table if not exists task_runs (
  id bigserial primary key,
  task text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb
);
create index if not exists task_runs_task on task_runs (task, started_at desc);

create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
