// Read models for the sheets and tabs other than the Brief.
import { db } from "../db";
import { feedbackLens, toItem, viewUrl } from "./brief";
import { tierOf } from "../pipeline/score";
import { CATEGORY_LABEL } from "../pipeline/rules";
import type { AlertT, CompanyT, EventDetailT, FilingT, HoldingT, JobT, RuleT } from "./types";

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : "");
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const HOW: Record<string, string> = {
  results: "Results always matter: the four headline numbers are read from the filing's statement page and checked arithmetically.",
  management_change: "Who runs the capital matters. Exits of a CEO, CFO, MD or auditor that are not retirements are flagged.",
  "M&A": "Deals are sized against the company's market value; a deal worth 10% or more of it scores higher.",
  fund_raise: "Equity raises dilute holders; the size against market value is the news.",
  credit_rating: "Reaffirmations are routine; downgrades are flagged.",
  pledging: "New promoter pledges are a classic risk signal.",
  litigation: "Most litigation is routine; size and the regulator decide.",
  press_release: "Order wins are sized against revenue; other releases stay low unless they move the stock.",
};

export async function getEvent(userId: string, key: string): Promise<EventDetailT | null> {
  const sql = db();
  const rows = await sql`select e.*, c.name, h.weight_pct, a.pdf_url from events e join companies c on c.symbol = e.symbol
    left join holdings h on h.symbol = e.symbol and h.user_id = ${userId} left join announcements a on a.id = e.primary_id
    where e.event_key = ${key}`;
  if (!rows.length) return null;
  const lens = await feedbackLens(userId);
  const sig = await sql`select d, ret_pct, vol_ratio, ret_z from price_signals where explained_by = ${key} order by d desc limit 1`;
  const item = toItem(rows[0], lens, sig.length ? { d: day(sig[0].d), ret_pct: num(sig[0].ret_pct), vol_ratio: num(sig[0].vol_ratio) } : null);
  const f = await sql`select id, subject, headline, filed_at, category, subtype, pdf_url, is_primary, one_liner from announcements
    where event_key = ${key} or id = ${String(rows[0].primary_id ?? "")} order by is_primary desc, filed_at`;
  const seen = new Set<string>();
  const filings: FilingT[] = [];
  for (const x of f) {
    if (seen.has(String(x.id))) continue;
    seen.add(String(x.id));
    filings.push({
      id: String(x.id), subject: String(x.subject), headline: (x.headline as string | null) ?? null, at: iso(x.filed_at),
      category: (x.category as string | null) ?? null, subtype: (x.subtype as string | null) ?? null, pdf_url: (x.pdf_url as string | null) ?? null,
      view_url: viewUrl((x.pdf_url as string | null) ?? null), is_primary: !!x.is_primary, one_liner: (x.one_liner as string | null) ?? null,
    });
  }
  const fb = await sql`select action from feedback where user_id = ${userId} and event_key = ${key}`;
  return {
    item, filings, error: rows[0].status === "failed" ? String(rows[0].error ?? "") : null,
    feedback: fb.map((x) => String(x.action)),
    signal: sig.length ? { d: day(sig[0].d), ret_pct: num(sig[0].ret_pct), vol_ratio: num(sig[0].vol_ratio), ret_z: num(sig[0].ret_z) } : null,
    how: HOW[item.category] ?? `${CATEGORY_LABEL[item.category] ?? item.category} filings score low unless they are large or move the stock.`,
  };
}

/** Early signal alerts linked to /company/SYM; the page lives at /company?s=SYM. */
function fixUrl(u: string | null): string | null {
  const m = u?.match(/^\/company\/([^/?#]+)$/);
  return m ? `/company?s=${m[1]}` : u;
}

export async function listAlerts(userId: string): Promise<{ alerts: AlertT[]; unread: number }> {
  const rows = await db()`select a.*, r.label as rule_label from alerts a left join alert_rules r on r.id = a.rule_id
    where a.user_id = ${userId} order by a.created_at desc limit 100`;
  const alerts: AlertT[] = rows.map((r) => ({
    id: Number(r.id), symbol: (r.symbol as string | null) ?? null, kind: r.kind as AlertT["kind"], title: String(r.title),
    body: (r.body as string | null) ?? null, url: fixUrl((r.url as string | null) ?? null), at: iso(r.created_at), read: !!r.read_at,
    rule: (r.rule_label as string | null) ?? null,
  }));
  return { alerts, unread: alerts.filter((a) => !a.read).length };
}

export async function listRules(userId: string): Promise<RuleT[]> {
  const rows = await db()`select * from alert_rules where user_id = ${userId} order by kind = 'category' desc, created_at`;
  return rows.map((r) => ({
    id: Number(r.id), kind: r.kind as RuleT["kind"], symbol: (r.symbol as string | null) ?? null, params: r.params as Record<string, unknown>,
    label: String(r.label), source_text: (r.source_text as string | null) ?? null, enabled: !!r.enabled,
  }));
}

export async function listHoldings(userId: string): Promise<HoldingT[]> {
  const sql = db();
  const rows = await sql`select h.symbol, h.weight_pct, c.name, coalesce(c.sector, c.industry) as sector, c.last_close, c.last_close_d, c.backfilled_at,
      s.ret_pct, s.vol_ratio
    from holdings h join companies c on c.symbol = h.symbol
    left join lateral (select ret_pct, vol_ratio from price_signals p where p.symbol = h.symbol order by d desc limit 1) s on true
    where h.user_id = ${userId} order by h.weight_pct desc nulls last, h.symbol`;
  const syms = rows.map((r) => String(r.symbol));
  const latest = syms.length ? await sql`select distinct on (symbol) symbol, event_key, title, first_filed_at, base_score + market_bonus as score
    from events where symbol in ${sql(syms)} and base_score + market_bonus >= 40 order by symbol, first_filed_at desc` : [];
  const sparks = syms.length ? await sql`select symbol, array_agg(close order by d) as closes from (
      select symbol, d, close, row_number() over (partition by symbol order by d desc) as rn from prices where symbol in ${sql(syms)}) t
    where rn <= 30 group by symbol` : [];
  const jobs = syms.length ? await sql`select symbol from jobs where kind = 'backfill' and status in ('queued', 'running') and symbol in ${sql(syms)}` : [];
  const backfilling = new Set(jobs.map((j) => String(j.symbol)));
  return rows.map((r) => {
    const l = latest.find((x) => x.symbol === r.symbol);
    const sp = sparks.find((x) => x.symbol === r.symbol);
    return {
      symbol: String(r.symbol), name: String(r.name), sector: (r.sector as string | null) ?? null, weight_pct: num(r.weight_pct),
      last_close: num(r.last_close), last_d: r.last_close_d ? day(r.last_close_d) : null, ret_pct: num(r.ret_pct), vol_ratio: num(r.vol_ratio),
      latest: l ? { key: String(l.event_key), title: String(l.title), at: iso(l.first_filed_at), tier: tierOf(Number(l.score)) } : null,
      backfilling: backfilling.has(String(r.symbol)) || !r.backfilled_at,
      spark: ((sp?.closes as unknown[]) ?? []).map(Number),
    };
  });
}

export async function getCompany(userId: string, symbol: string): Promise<CompanyT | null> {
  const sql = db();
  const [c] = await sql`select c.*, exists(select 1 from holdings h where h.user_id = ${userId} and h.symbol = c.symbol) as held from companies c where c.symbol = ${symbol}`;
  if (!c) return null;
  const prices = await sql`select d, close, volume from (select d, close, volume from prices where symbol = ${symbol} order by d desc limit 120) t order by d`;
  const events = await sql`select event_key, title, first_filed_at, category, subtype, base_score + market_bonus as score from events
    where symbol = ${symbol} and base_score + market_bonus >= 15 order by first_filed_at desc limit 25`;
  const up = await sql`select meeting_date from upcoming_results where symbol = ${symbol} and meeting_date >= current_date order by meeting_date limit 1`;
  const d = await sql`select version, created_at from dossiers where symbol = ${symbol} order by created_at desc limit 1`;
  const s = await sql`select d, ret_pct, vol_ratio, explained_by from price_signals where symbol = ${symbol} order by d desc limit 1`;
  return {
    symbol, name: String(c.name), sector: (c.sector ?? c.industry ?? null) as string | null, mcap_cr: num(c.mcap_cr), is_financial: !!c.is_financial, held: !!c.held,
    prices: prices.map((p) => ({ d: day(p.d), close: Number(p.close), volume: Number(p.volume ?? 0) })),
    events: events.map((e) => ({ key: String(e.event_key), title: String(e.title), at: iso(e.first_filed_at), category: String(e.category), subtype: (e.subtype as string | null) ?? null, score: Number(e.score), tier: tierOf(Number(e.score)) })),
    upcoming: up.length ? day(up[0].meeting_date) : null,
    dossier: d.length ? { version: String(d[0].version), built_at: iso(d[0].created_at) } : null,
    signal: s.length ? { d: day(s[0].d), ret_pct: num(s[0].ret_pct), vol_ratio: num(s[0].vol_ratio), explained_by: (s[0].explained_by as string | null) ?? null } : null,
  };
}

export async function getJob(id: string): Promise<JobT | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db()`select * from jobs where id = ${id}`;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id), kind: String(r.kind), symbol: (r.symbol as string | null) ?? null, status: r.status as JobT["status"],
    step: (r.step as string | null) ?? null, progress: Number(r.progress ?? 0), log: (r.log as JobT["log"]) ?? [], error: (r.error as string | null) ?? null,
    version: ((r.result as { version?: string } | null)?.version) ?? null,
  };
}

export async function costSummary() {
  const sql = db();
  const byTask = await sql`select task, count(*)::int as calls, count(*) filter (where cache_hit)::int as cached,
      count(*) filter (where not ok)::int as failed, coalesce(sum(tokens_in), 0)::bigint as tin, coalesce(sum(tokens_out), 0)::bigint as tout,
      coalesce(sum(cost_usd_est), 0)::float as usd
    from llm_calls group by task order by calls desc`;
  const byModel = await sql`select model, provider, count(*) filter (where not cache_hit)::int as calls, coalesce(sum(tokens_in), 0)::bigint as tin,
      coalesce(sum(tokens_out), 0)::bigint as tout, coalesce(sum(cost_usd_est), 0)::float as usd
    from llm_calls where ok group by model, provider order by calls desc`;
  const [t] = await sql`select count(*)::int as calls, count(*) filter (where cache_hit)::int as cached, coalesce(sum(cost_usd_est), 0)::float as usd,
      count(*) filter (where created_at > now() - interval '24 hours' and not cache_hit and ok)::int as calls_24h
    from llm_calls`;
  // "No model call" counts the rules, the results-day context and the letter reading.
  const [a] = await sql`select count(*)::int as filings,
      count(*) filter (where classified_by like 'rule:%' or classified_by like 'pdf-%')::int as by_rule,
      count(*) filter (where classified_by = 'llm')::int as by_model from announcements`;
  const dossiers = await sql`select symbol, stats, created_at from dossiers order by created_at desc limit 12`;
  return {
    totals: { calls: Number(t.calls), cached: Number(t.cached), usd: Number(t.usd), calls_24h: Number(t.calls_24h) },
    classification: { filings: Number(a.filings), by_rule: Number(a.by_rule), by_model: Number(a.by_model) },
    by_task: byTask.map((r) => ({ task: String(r.task), calls: Number(r.calls), cached: Number(r.cached), failed: Number(r.failed), tokens_in: Number(r.tin), tokens_out: Number(r.tout), usd: Number(r.usd) })),
    by_model: byModel.map((r) => ({ model: String(r.model), provider: String(r.provider), calls: Number(r.calls), tokens_in: Number(r.tin), tokens_out: Number(r.tout), usd: Number(r.usd) })),
    dossiers: dossiers.map((d) => ({ symbol: String(d.symbol), at: iso(d.created_at), ...(d.stats as Record<string, number>) })),
  };
}
