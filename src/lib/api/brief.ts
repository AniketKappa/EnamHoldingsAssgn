// The Brief read model: events in a window for one user's holdings, ranked
// at read time (spec 5.2, 11.1), split into tiers, with the funnel counts.
import { db } from "../db";
import { finalScore, tierOf } from "../pipeline/score";
import { istAt, istDate, istMinutes, isWeekdayIst } from "../time";
import { llmConfigured } from "../llm/router";
import { attachmentViewUrl } from "../sources/bse";
import type { BriefItem, BriefT, ResultsCardT, PersonT } from "./types";

export const WINDOWS: Record<string, { hours: number; label: string }> = {
  "24h": { hours: 24, label: "Last 24 hours" },
  "3d": { hours: 72, label: "Last 3 days" },
  "7d": { hours: 168, label: "Last 7 days" },
  "30d": { hours: 720, label: "Last 30 days" },
};

export function resolveWindow(w: string | null, from: string | null, to: string | null, now = new Date()) {
  if (w === "custom" && from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const end = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : istDate(now);
    const a = istAt(from, 0, 0), b = new Date(istAt(end, 0, 0).getTime() + 86_400_000);
    return { key: "custom", from: a, to: b, label: from === end ? from : `${from} to ${end}` };
  }
  const k = w && WINDOWS[w] ? w : "24h";
  return { key: k, from: new Date(now.getTime() - WINDOWS[k].hours * 3_600_000), to: now, label: WINDOWS[k].label };
}

type Row = Record<string, unknown>;

/** Feedback per user: "Not useful" on a category and company => x0.7; "Mute category" => x0.3. */
export async function feedbackLens(userId: string) {
  const rows = await db()`select event_key, action, category, symbol from feedback where user_id = ${userId}`;
  const done = new Set<string>();
  const notUseful = new Set<string>();
  const muted = new Set<string>();
  for (const r of rows) {
    if (r.action === "done") done.add(String(r.event_key));
    if (r.action === "not_useful") notUseful.add(`${r.category}|${r.symbol}`);
    if (r.action === "mute_category") muted.add(String(r.category));
  }
  const multiplier = (category: string, symbol: string) => (muted.has(category) ? 0.3 : 1) * (notUseful.has(`${category}|${symbol}`) ? 0.7 : 1);
  return { done, multiplier };
}

export function toItem(r: Row, lens: { done: Set<string>; multiplier: (c: string, s: string) => number }, market?: BriefItem["market"]): BriefItem {
  const detail = (r.detail as Record<string, unknown>) ?? {};
  const category = String(r.category);
  const symbol = String(r.symbol);
  const score = finalScore({
    base: Number(r.base_score ?? 0), market: Number(r.market_bonus ?? 0),
    weightPct: r.weight_pct === null || r.weight_pct === undefined ? null : Number(r.weight_pct),
    feedbackMultiplier: lens.multiplier(category, symbol),
  });
  const results = detail.results as ResultsCardT | undefined;
  const people = detail.people as PersonT[] | undefined;
  const guidance = detail.guidance_change as BriefItem["guidance"] | undefined;
  const reasons = [...((r.reasons as string[]) ?? [])];
  const w = r.weight_pct === null || r.weight_pct === undefined ? null : Number(r.weight_pct);
  if (w && w >= 5) reasons.push(`${w}% of portfolio`);
  const pdf = (detail.pdf_url as string | null | undefined) ?? (results?.pdf_url ?? (r.pdf_url as string | null) ?? null);
  return {
    key: String(r.event_key), symbol, company: String(r.name ?? symbol), category, subtype: (r.subtype as string | null) ?? null,
    title: String(r.title), at: new Date(r.first_filed_at as string).toISOString(), filings: Number(r.filings ?? 1),
    score, tier: tierOf(score), reasons: [...new Set(reasons)].slice(0, 6), red_flags: (r.red_flags as string[]) ?? [],
    kind: results ? "results" : people?.length ? "person" : guidance ? "guidance" : "generic",
    results, people, primary_index: Number(detail.primary_index ?? 0),
    one_liner: (detail.one_liner as string | null | undefined) ?? null, amount_cr: (detail.amount_cr as number | null | undefined) ?? null,
    pdf_url: pdf, status: String(r.status ?? "done"), done: lens.done.has(String(r.event_key)), weight_pct: w,
    market: market ?? null, guidance,
  };
}

export function viewUrl(pdfUrl: string | null): string | null {
  if (!pdfUrl) return null;
  const m = pdfUrl.match(/corpfiling\/Attach(?:Live|His)\/([^/?#]+)$/);
  return m ? attachmentViewUrl(m[1]) : pdfUrl;
}

export async function freshness() {
  const sql = db();
  const rows = await sql`select task, max(started_at) filter (where ok) as at from task_runs where task in ('poll', 'prices') group by task`;
  const poll = rows.find((r) => r.task === "poll")?.at as string | undefined;
  const prices = rows.find((r) => r.task === "prices")?.at as string | undefined;
  const now = new Date();
  const marketHours = isWeekdayIst(now) && istMinutes(now) >= 9 * 60 + 15 && istMinutes(now) <= 15 * 60 + 30;
  const delayed = !!poll && marketHours && now.getTime() - new Date(poll).getTime() > 30 * 60_000;
  return { filings_checked_at: poll ? new Date(poll).toISOString() : null, prices_at: prices ? new Date(prices).toISOString() : null, delayed };
}

export async function getBrief(userId: string, w: string | null, from: string | null, to: string | null): Promise<BriefT> {
  const sql = db();
  const win = resolveWindow(w, from, to);
  const lens = await feedbackLens(userId);
  const rows = await sql`select e.*, c.name, h.weight_pct, a.pdf_url
    from events e
    join holdings h on h.symbol = e.symbol and h.user_id = ${userId}
    join companies c on c.symbol = e.symbol
    left join announcements a on a.id = e.primary_id
    where e.first_filed_at >= ${win.from} and e.first_filed_at < ${win.to}`;
  const keys = rows.map((r) => String(r.event_key));
  const markets = keys.length ? await sql`select explained_by, d, ret_pct, vol_ratio from price_signals where explained_by in ${sql(keys)}` : [];
  const marketOf = new Map(markets.map((m) => [String(m.explained_by), { d: new Date(m.d as string).toISOString().slice(0, 10), ret_pct: m.ret_pct === null ? null : Number(m.ret_pct), vol_ratio: m.vol_ratio === null ? null : Number(m.vol_ratio) }]));
  const items = rows.map((r) => toItem(r, lens, marketOf.get(String(r.event_key)))).sort((a, b) => b.score - a.score || b.at.localeCompare(a.at));
  const top = items.filter((i) => i.tier === "top");
  const worth = items.filter((i) => i.tier === "worth");
  const routine = items.filter((i) => i.tier === "routine");
  const hidden = items.filter((i) => i.tier === "hidden");
  const [{ n: filings }] = await sql`select count(*)::int as n from announcements a join holdings h on h.symbol = a.symbol and h.user_id = ${userId}
    where a.filed_at >= ${win.from} and a.filed_at < ${win.to}`;
  const [{ n: holdingsN }] = await sql`select count(*)::int as n from holdings where user_id = ${userId}`;
  let quiet: BriefT["quiet"] = null;
  if (!top.length && !worth.length) {
    const last = await sql`select e.symbol, e.title, e.first_filed_at from events e join holdings h on h.symbol = e.symbol and h.user_id = ${userId}
      where e.base_score + e.market_bonus >= 40 and e.first_filed_at < ${win.from} order by e.first_filed_at desc limit 1`;
    quiet = { last_material: last.length ? { symbol: String(last[0].symbol), title: String(last[0].title), at: new Date(last[0].first_filed_at as string).toISOString() } : null };
  }
  const upcoming = await sql`select u.symbol, c.name, u.meeting_date from upcoming_results u join holdings h on h.symbol = u.symbol and h.user_id = ${userId}
    join companies c on c.symbol = u.symbol where u.meeting_date >= current_date order by u.meeting_date limit 4`;
  const actionable = [...top, ...worth];
  return {
    window: { key: win.key, from: win.from.toISOString(), to: win.to.toISOString(), label: win.label },
    funnel: { filings: Number(filings), events: top.length + worth.length, matter: top.length },
    top, worth,
    routine: { count: routine.length, items: routine.map((i) => ({ key: i.key, symbol: i.symbol, title: i.title, at: i.at })) },
    hidden_count: hidden.length,
    quiet,
    upcoming: upcoming.map((u) => ({ symbol: String(u.symbol), name: String(u.name), date: new Date(u.meeting_date as string).toISOString().slice(0, 10) })),
    holdings: Number(holdingsN),
    freshness: await freshness(),
    caught_up: actionable.length > 0 && actionable.every((i) => i.done),
    configured: { llm: llmConfigured() },
  };
}
