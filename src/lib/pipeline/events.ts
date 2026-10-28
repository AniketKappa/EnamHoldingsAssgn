// Stage 4: group filings into events and keep each event's score current.
// A results day (outcome, results PDF, presentation, call notice, newspaper
// ad) becomes one event; everything else is its own event (spec B.3).
// Grouping is computed in memory and written in a few set-based statements.
import { db } from "../db";
import { quarterEndOnOrBefore, fiscalQuarterLabel } from "../time";
import { scoreEvent } from "./score";
import { shortRole } from "./peopleRules";
import { defaultSubtype } from "./classify";
import { truncate } from "../text";

const JOIN_WINDOW_MS = 36 * 3600 * 1000;

/** Which extractor an event needs, or null when the title is enough. */
export function extractorFor(category: string, subtype: string | null, subject = ""): "results" | "people" | "one_liner" | null {
  switch (category) {
    case "results": return subtype === "financial_results" ? "results" : null;
    case "management_change": return "people";
    case "M&A": case "fund_raise": case "credit_rating": case "litigation": case "pledging": case "capex":
    case "dividend": case "bonus_split": case "press_release":
      return "one_liner";
    case "insider_trading": return subtype === "promoter_buy" || subtype === "promoter_sell" ? "one_liner" : null;
    case "agm_egm": case "postal_ballot":
      return /voting result|scrutini[sz]er/i.test(subject) ? "one_liner" : null;
    default: return null;
  }
}

export function cleanTitle(subject: string, headline: string | null): string {
  const h = (headline ?? "").replace(/\s+/g, " ").trim();
  const s = subject.replace(/\s+/g, " ").trim();
  // BSE headlines are often the useful sentence; subjects are often a form name.
  const pick = h.length > 15 && h.length < 400 ? h : s;
  return truncate(pick, 200);
}

export interface FilingIn { id: string; symbol: string; subject: string; headline: string | null; category: string; subtype: string | null; filed_at: Date; also: string[] }
export interface EventOut {
  event_key: string; symbol: string; category: string; subtype: string | null; title: string; primary_id: string;
  first: Date; last: Date; filings: number; status: string;
}
export interface Assignment { id: string; event_key: string; is_primary: boolean }

/** Pure grouping: which event each filing belongs to. `existing` holds results events already stored. */
export function groupFilings(
  filings: FilingIn[],
  existing: { event_key: string; symbol: string; first_filed_at: Date }[],
): { events: Map<string, EventOut>; assignments: Assignment[] } {
  const events = new Map<string, EventOut>();
  const assignments: Assignment[] = [];
  const resultsBySymbol = new Map<string, { key: string; at: number }[]>();
  for (const e of existing) {
    const list = resultsBySymbol.get(e.symbol) ?? [];
    list.push({ key: e.event_key, at: new Date(e.first_filed_at).getTime() });
    resultsBySymbol.set(e.symbol, list);
  }
  const existingKeys = new Set(existing.map((e) => e.event_key));
  const ordered = [...filings].sort((a, b) =>
    Number(b.subtype === "financial_results" && b.category === "results") - Number(a.subtype === "financial_results" && a.category === "results")
    || a.filed_at.getTime() - b.filed_at.getTime());

  const touch = (key: string, f: FilingIn, init: () => Omit<EventOut, "first" | "last" | "filings">) => {
    const ev = events.get(key);
    if (ev) {
      ev.filings += 1;
      if (f.filed_at < ev.first) ev.first = f.filed_at;
      if (f.filed_at > ev.last) ev.last = f.filed_at;
      return false;
    }
    events.set(key, { ...init(), first: f.filed_at, last: f.filed_at, filings: 1 });
    return true;
  };

  for (const f of ordered) {
    const text = `${f.subject} ${f.headline ?? ""}`.toLowerCase();
    const title = cleanTitle(f.subject, f.headline);
    if (f.category === "results" && f.subtype === "financial_results") {
      const qe = quarterEndOnOrBefore(f.filed_at);
      const key = `${f.symbol}:results:${qe}`;
      const isNew = touch(key, f, () => ({
        event_key: key, symbol: f.symbol, category: "results", subtype: "financial_results",
        title: `${fiscalQuarterLabel(qe)} results`, primary_id: f.id, status: "pending",
      }));
      const primary = isNew && !existingKeys.has(key);
      assignments.push({ id: f.id, event_key: key, is_primary: primary });
      if (primary) {
        const list = resultsBySymbol.get(f.symbol) ?? [];
        list.push({ key, at: f.filed_at.getTime() });
        resultsBySymbol.set(f.symbol, list);
      }
    } else {
      const joinable = (f.category === "results" && (f.subtype === "results_admin" || f.subtype === "results_notice"))
        || (f.category === "earnings_call" && (f.subtype === "presentation" || f.subtype === "call_notice" || f.subtype === "recording"))
        || (f.category === "press_release" && /result/.test(text));
      let joined: string | null = null;
      if (joinable) {
        const near = (resultsBySymbol.get(f.symbol) ?? [])
          .filter((r) => Math.abs(r.at - f.filed_at.getTime()) < JOIN_WINDOW_MS)
          .sort((a, b) => Math.abs(a.at - f.filed_at.getTime()) - Math.abs(b.at - f.filed_at.getTime()));
        if (near.length) joined = near[0].key;
      }
      if (joined) {
        touch(joined, f, () => ({ event_key: joined!, symbol: f.symbol, category: "results", subtype: "financial_results", title: "", primary_id: "", status: "pending" }));
        assignments.push({ id: f.id, event_key: joined, is_primary: false });
      } else {
        const key = `${f.symbol}:${f.id}`;
        touch(key, f, () => ({
          event_key: key, symbol: f.symbol, category: f.category, subtype: f.subtype, title, primary_id: f.id,
          status: extractorFor(f.category, f.subtype, f.subject) ? "pending" : "skipped",
        }));
        assignments.push({ id: f.id, event_key: key, is_primary: true });
      }
    }
    // Extra categories found inside a results outcome get events of their own.
    for (const extra of f.also ?? []) {
      const key = `${f.symbol}:${extra}:${f.id}`;
      const sub = defaultSubtype(extra);
      touch(key, f, () => ({
        event_key: key, symbol: f.symbol, category: extra, subtype: sub, title, primary_id: f.id,
        status: extractorFor(extra, sub, f.subject) ? "pending" : "skipped",
      }));
    }
  }
  return { events, assignments };
}

export async function groupNew(limit = 2000): Promise<number> {
  const sql = db();
  const rows = await sql`select id, symbol, subject, headline, category, subtype, filed_at, also from announcements
    where status = 'classified' order by filed_at limit ${limit}`;
  if (!rows.length) return 0;
  const filings: FilingIn[] = rows.map((r) => ({
    id: String(r.id), symbol: String(r.symbol), subject: String(r.subject), headline: (r.headline as string | null) ?? null,
    category: String(r.category), subtype: (r.subtype as string | null) ?? null, filed_at: new Date(r.filed_at as string),
    also: (r.also as string[]) ?? [],
  }));
  const symbols = [...new Set(filings.map((f) => f.symbol))];
  const minT = new Date(Math.min(...filings.map((f) => f.filed_at.getTime())) - JOIN_WINDOW_MS);
  const maxT = new Date(Math.max(...filings.map((f) => f.filed_at.getTime())) + JOIN_WINDOW_MS);
  const existing = await sql`select event_key, symbol, first_filed_at from events
    where category = 'results' and subtype = 'financial_results' and symbol in ${sql(symbols)}
      and first_filed_at between ${minT} and ${maxT}`;
  const { events, assignments } = groupFilings(filings, existing.map((e) => ({
    event_key: String(e.event_key), symbol: String(e.symbol), first_filed_at: new Date(e.first_filed_at as string),
  })));

  const mcaps = new Map<string, number | null>();
  for (const c of await sql`select symbol, mcap_cr from companies where symbol in ${sql(symbols)}`) {
    mcaps.set(String(c.symbol), c.mcap_cr === null ? null : Number(c.mcap_cr));
  }
  const evRows = [...events.values()].map((e) => {
    const s = scoreEvent({ category: e.category, subtype: e.subtype, mcapCr: mcaps.get(e.symbol) ?? null });
    return {
      event_key: e.event_key, symbol: e.symbol, category: e.category, subtype: e.subtype, title: e.title || e.category,
      primary_id: e.primary_id || null, first_filed_at: e.first, last_filed_at: e.last, filings: e.filings, status: e.status,
      base_score: s.base, reasons: JSON.stringify(s.reasons),
    };
  });
  for (let i = 0; i < evRows.length; i += 200) {
    const chunk = evRows.slice(i, i + 200);
    await sql`insert into events ${sql(chunk.map((r) => ({ ...r, reasons: sql.json(JSON.parse(r.reasons)) })) as never,
      "event_key", "symbol", "category", "subtype", "title", "primary_id", "first_filed_at", "last_filed_at", "filings", "status", "base_score", "reasons")}
      on conflict (event_key) do update set
        first_filed_at = least(events.first_filed_at, excluded.first_filed_at),
        last_filed_at = greatest(events.last_filed_at, excluded.last_filed_at),
        filings = events.filings + excluded.filings, updated_at = now()`;
  }
  for (let i = 0; i < assignments.length; i += 300) {
    const chunk = assignments.slice(i, i + 300).map((a) => [a.id, a.event_key, a.is_primary ? "t" : "f"]);
    await sql`update announcements as a set event_key = v.event_key, is_primary = v.is_primary::boolean, status = 'grouped'
      from (values ${sql(chunk as never)}) as v(id, event_key, is_primary) where a.id = v.id`;
  }
  return rows.length;
}

/** Recompute an event's global score from its category, extraction and the company's size. */
export async function rescoreEvent(eventKey: string): Promise<void> {
  const sql = db();
  const [e] = await sql`select e.*, c.mcap_cr, c.revenue_cr from events e left join companies c on c.symbol = e.symbol where e.event_key = ${eventKey}`;
  if (!e) return;
  const detail = (e.detail as Record<string, unknown>) ?? {};
  let subtype = (e.subtype as string | null) ?? null;
  const category = String(e.category);
  if (category === "credit_rating") {
    const dir = detail.direction as string | undefined;
    if (dir === "down") subtype = "downgrade";
    else if (dir === "up" && subtype !== "downgrade") subtype = "upgrade";
  }
  let roleLabel: string | null = null;
  const people = detail.people as { designation: string; change_type: string }[] | undefined;
  if (category === "management_change" && people?.length) {
    const p = people[Number(detail.primary_index ?? 0)] ?? people[0];
    const role = shortRole(p.designation);
    roleLabel = p.change_type === "appointment" ? `New ${role}` : p.change_type === "redesignation" ? `${role} re-designated`
      : p.change_type === "reappointment" ? `${role} re-appointed` : `${role} exit`;
  }
  const s = scoreEvent({
    category, subtype,
    amountCr: (detail.amount_cr as number | null) ?? null,
    mcapCr: e.mcap_cr ? Number(e.mcap_cr) : null,
    revenueCr: e.revenue_cr ? Number(e.revenue_cr) : null,
    redFlags: (e.red_flags as string[]) ?? [],
    roleLabel,
  });
  let base = s.base;
  const reasons = [...s.reasons];
  if ((category === "postal_ballot" || category === "agm_egm") && detail.failed_vote) {
    base = Math.max(base, 60);
    reasons.push("Resolution failed");
  }
  if (category === "management_change" && people?.length && people.every((p) => p.change_type === "reappointment")) {
    base = Math.min(base, 30); // a routine re-appointment is not news
  }
  if (category === "results") {
    const r = detail.results as { checks_ok?: boolean; unreliable?: boolean; reasons?: string[] } | undefined;
    if (r?.reasons) reasons.push(...r.reasons);
    if (r && (r.unreliable || r.checks_ok === false)) reasons.push("Numbers unverified");
  }
  const marketChips = ((e.reasons as string[]) ?? []).filter((x) => /^(Price|Volume) /.test(x));
  await sql`update events set subtype = ${subtype}, base_score = ${base},
    reasons = ${sql.json(dedupe([...reasons.slice(0, 3), ...marketChips]).slice(0, 4))}, updated_at = now()
    where event_key = ${eventKey}`;
}

function dedupe(a: string[]): string[] { return [...new Set(a.filter(Boolean))]; }
