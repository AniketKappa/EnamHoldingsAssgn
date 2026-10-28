// Stage 7: match each user's watch rules against new events and end-of-day
// signals. Code evaluates every rule; the model only ever drafts rules from
// plain English (rules.ts), and the user confirms them as chips.
import { db } from "../db";
import { pct, multiple, whenIst } from "../format";
import { signalHits } from "./signals";

export interface RuleParams { categories?: string[] | null; subtypes?: string[] | null; pct?: number | null; multiple?: number | null; z?: number | null }
export interface Rule { id: number; user_id: string; kind: "category" | "price_move" | "volume_spike" | "sigma_move"; symbol: string | null; params: RuleParams; label: string; enabled: boolean }

export const DEFAULT_RULES: Omit<Rule, "id" | "user_id" | "enabled">[] = [
  { kind: "category", symbol: null, params: { categories: ["results"], subtypes: ["financial_results"] }, label: "Quarterly results" },
  { kind: "category", symbol: null, params: { categories: ["management_change"], subtypes: ["top", "auditor_exit"] }, label: "CEO, CFO, MD, chair or auditor changes" },
  { kind: "category", symbol: null, params: { categories: ["M&A"], subtypes: ["acquisition", "restructuring", "divestment", "jv"] }, label: "Acquisitions, mergers and stake sales" },
  { kind: "category", symbol: null, params: { categories: ["fund_raise"], subtypes: ["equity_raise", "buyback", "fund_raise_other"] }, label: "Equity raises and buybacks" },
  { kind: "category", symbol: null, params: { categories: ["credit_rating"], subtypes: ["downgrade"] }, label: "Credit rating downgrades" },
  { kind: "category", symbol: null, params: { categories: ["pledging"], subtypes: ["pledge_create"] }, label: "New promoter pledges" },
  { kind: "price_move", symbol: null, params: { pct: 4 }, label: "Any holding moves 4% in a day" },
  { kind: "volume_spike", symbol: null, params: { multiple: 2 }, label: "Volume at 2× its 20-day average" },
];

export function ruleMatchesEvent(rule: Pick<Rule, "kind" | "symbol" | "params">, ev: { symbol: string; category: string; subtype: string | null }): boolean {
  if (rule.kind !== "category") return false;
  if (rule.symbol && rule.symbol !== ev.symbol) return false;
  const cats = rule.params.categories ?? [];
  if (cats.length && !cats.includes(ev.category)) return false;
  const subs = rule.params.subtypes ?? [];
  if (subs.length && !(ev.subtype && subs.includes(ev.subtype))) return false;
  return true;
}

export function ruleMatchesSignal(rule: Pick<Rule, "kind" | "symbol" | "params">, s: { symbol: string; ret_pct: number | null; vol_ratio: number | null; ret_z: number | null }): boolean {
  if (rule.symbol && rule.symbol !== s.symbol) return false;
  const h = signalHits({ d: "", close: 0, ...s }, {
    pct: rule.params.pct ?? Infinity, multiple: rule.params.multiple ?? Infinity, z: rule.params.z ?? Infinity,
  });
  if (rule.kind === "price_move") return h.price;
  if (rule.kind === "volume_spike") return h.volume;
  if (rule.kind === "sigma_move") return h.sigma;
  return false;
}

export function signalTitle(symbol: string, s: { ret_pct: number | null; vol_ratio: number | null }): string {
  const parts = [`${symbol} ${pct(s.ret_pct)}`];
  if (s.vol_ratio !== null && s.vol_ratio >= 1.5) parts.push(`volume ${multiple(s.vol_ratio)} its 20-day average`);
  return parts.join(", ");
}

/** Evaluate rules for every user. Only fresh items alert, so a backfill never floods the inbox. */
export async function evaluateAlerts(): Promise<{ events: number; signals: number }> {
  const sql = db();
  const rules = (await sql`select r.* from alert_rules r where r.enabled`) as unknown as Rule[];
  if (!rules.length) return { events: 0, signals: 0 };
  const holdings = await sql`select user_id, symbol from holdings`;
  const held = new Map<string, Set<string>>();
  for (const h of holdings) {
    const u = String(h.user_id);
    if (!held.has(u)) held.set(u, new Set());
    held.get(u)!.add(String(h.symbol));
  }

  // Events: filed in the last 36 hours, extracted (or waiting more than 30 minutes).
  const events = await sql`select event_key, symbol, category, subtype, title, reasons, base_score from events
    where first_filed_at > now() - interval '36 hours' and base_score >= 15
      and (status <> 'pending' or updated_at < now() - interval '30 minutes')`;
  let ev = 0;
  for (const e of events) {
    for (const [userId, syms] of held) {
      if (!syms.has(String(e.symbol))) continue;
      const rule = rules.find((r) => r.user_id === userId && ruleMatchesEvent(r, { symbol: String(e.symbol), category: String(e.category), subtype: (e.subtype as string | null) ?? null }));
      if (!rule) continue;
      const reasons = (e.reasons as string[]) ?? [];
      const res = await sql`insert into alerts (user_id, rule_id, symbol, kind, ref_id, title, body, url)
        values (${userId}, ${rule.id}, ${String(e.symbol)}, 'event', ${String(e.event_key)}, ${`${e.symbol}: ${e.title}`},
          ${reasons.join(" · ") || null}, ${`/?e=${encodeURIComponent(String(e.event_key))}`})
        on conflict (user_id, ref_id) do nothing returning id`;
      ev += res.length;
    }
  }

  // Signals: the latest session only (and the one before, for late runs).
  const sigs = await sql`select s.*, e.title as ev_title, e.first_filed_at as ev_at from price_signals s
    left join events e on e.event_key = s.explained_by
    where s.d >= (select max(d) from price_signals) - 1`;
  let sg = 0;
  for (const s of sigs) {
    const sym = String(s.symbol);
    const sig = { symbol: sym, ret_pct: n(s.ret_pct), vol_ratio: n(s.vol_ratio), ret_z: n(s.ret_z) };
    for (const [userId, syms] of held) {
      if (!syms.has(sym)) continue;
      const rule = rules.find((r) => r.user_id === userId && r.kind !== "category" && ruleMatchesSignal(r, sig));
      if (!rule) continue;
      const d = s.d instanceof Date ? s.d.toISOString().slice(0, 10) : String(s.d).slice(0, 10);
      const body = s.explained_by
        ? `Explained by: ${s.ev_title}, filed ${whenIst(new Date(s.ev_at as string))}`
        : "No filing explains this move.";
      const res = await sql`insert into alerts (user_id, rule_id, symbol, kind, ref_id, title, body, url)
        values (${userId}, ${rule.id}, ${sym}, 'signal', ${`${sym}:${d}`}, ${signalTitle(sym, sig)}, ${body}, ${`/company/${encodeURIComponent(sym)}`})
        on conflict (user_id, ref_id) do nothing returning id`;
      sg += res.length;
    }
  }
  return { events: ev, signals: sg };
}

function n(v: unknown): number | null { return v === null || v === undefined ? null : Number(v); }

/** Create a user row; a new visitor gets their own editable copy of the demo portfolio and rules. */
export async function ensureUser(userId: string): Promise<boolean> {
  const sql = db();
  const ins = await sql`insert into users (id, last_seen_at) values (${userId}, now()) on conflict (id) do nothing returning id`;
  if (!ins.length) {
    await sql`update users set last_seen_at = now() where id = ${userId} and (last_seen_at is null or last_seen_at < now() - interval '10 minutes')`;
    return false;
  }
  if (userId !== "demo") {
    await sql`insert into holdings (user_id, symbol, weight_pct, thesis) select ${userId}, symbol, weight_pct, thesis from holdings where user_id = 'demo'
      on conflict do nothing`;
    await sql`insert into alert_rules (user_id, kind, symbol, params, label, source_text, enabled)
      select ${userId}, kind, symbol, params, label, source_text, enabled from alert_rules where user_id = 'demo'`;
  }
  return true;
}

export async function seedDefaultRules(userId: string) {
  const sql = db();
  const [{ c }] = await sql`select count(*)::int as c from alert_rules where user_id = ${userId}`;
  if (Number(c) > 0) return 0;
  for (const r of DEFAULT_RULES) {
    await sql`insert into alert_rules (user_id, kind, symbol, params, label) values (${userId}, ${r.kind}, ${r.symbol}, ${sql.json(r.params as never)}, ${r.label})`;
  }
  return DEFAULT_RULES.length;
}
