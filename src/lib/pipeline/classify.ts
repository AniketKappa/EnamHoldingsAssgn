// Stage 3: classify new filings. Rules first (free, about 90%), then three
// cheap steps before any model call:
//   1. a bare "Outcome of Board Meeting" on a results day is the results;
//   2. a generic "Disclosure under Regulation 30" is re-read from the
//      "Sub:" line of its own PDF and run through the same rules;
//   3. what is left goes to the cheapest model in batches of 25, with the
//      first 1,500 characters of the filing.
// Writes are batched because the database may be an ocean away.
import { db } from "../db";
import { classifyText, type Category } from "./rules";
import { llm, llmConfigured } from "../llm/router";
import { ClassifyBatch } from "../llm/schemas";
import { truncate } from "../text";
import { istDate } from "../time";
import { noteMeetings, noticeDates } from "./calendar";
import { fetchAndStore } from "./filings";

const DEFAULT_SUBTYPE: Record<string, string> = {
  results: "financial_results", management_change: "pending_people", "M&A": "acquisition",
  fund_raise: "fund_raise_other", litigation: "dispute", credit_rating: "rating_action",
  pledging: "pledge_create", insider_trading: "other_insider", earnings_call: "call_notice",
  capex: "capex", press_release: "general", dividend: "dividend", bonus_split: "bonus_split",
  postal_ballot: "postal_ballot", agm_egm: "agm_egm", investor_meetings: "meeting", unclassified: "compliance",
};

const CLASSIFY_PROMPT = `Classify each Indian listed-company filing into exactly one category, plus a subtype when one fits.
Categories: results (quarterly or annual results and their board outcome), M&A (acquisitions, mergers, demergers, JVs, stake sales, subsidiaries),
fund_raise (QIP, rights, preferential, buyback, NCDs, commercial paper), management_change (CEO, CFO, MD, director, KMP, auditor joining or leaving),
litigation (lawsuits, regulatory orders, penalties, insolvency), insider_trading (promoter or insider dealings), earnings_call (call notice, transcript, recording, presentation),
investor_meetings (analyst or investor meetings), credit_rating, dividend, bonus_split, capex (new capacity or plant), press_release (order wins, launches, partnerships, clarifications, business updates),
postal_ballot, agm_egm, pledging (promoter pledges), unclassified (routine compliance paperwork).
Judge by what the filing text says happened, not by the regulation it is filed under.
A board-meeting outcome that approves financial results is results. A newspaper advertisement of results is results with subtype results_admin.
If a filing covers several items, pick the most material in this order: results, management_change, M&A, fund_raise, litigation, credit_rating, pledging, capex,
insider_trading, dividend, bonus_split, press_release, earnings_call, agm_egm, postal_ballot, investor_meetings, unclassified.
Return one item per filing id.`;

const RESULTS_DAY_MS = 36 * 3600 * 1000;
const PDF_READS_PER_RUN = 30;

interface Update { id: string; category: string; subtype: string | null; by: string; also: string[] }
interface Row {
  id: string; symbol: string; subject: string; headline: string | null; subcategory: string | null;
  nse_text: string | null; filed_at: Date; pdf_url: string | null;
}

async function writeUpdates(rows: Update[]) {
  if (!rows.length) return;
  const sql = db();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((u) => [u.id, u.category, u.subtype ?? "", u.by, JSON.stringify(u.also)]);
    await sql`update announcements as a set category = v.category, subtype = nullif(v.subtype, ''), classified_by = v.by,
        also = v.also::jsonb, status = 'classified'
      from (values ${sql(chunk as never)}) as v(id, category, subtype, by, also)
      where a.id = v.id`;
  }
}

/**
 * The "Sub:" line of a cover letter: what the filing is about, in the company's
 * own words. Null when the letter has none. Most say only "Disclosure under
 * Regulation 30", so the body's first sentences are read too (bodyLead).
 */
export function subjectLine(text: string): { line: string; at: number; end: number } | null {
  const re = /(?:^|\s)(?:sub(?:ject|iect)?\s*\.?\s*[:\-–]?|re\s*:|ref\s*:)\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    if (/^(bse|nse|scrip|isin|no\b|letter|our )/i.test(text.slice(start, start + 12))) continue;
    const rest = text.slice(start, start + 450);
    const stop = rest.search(/\n\s*\n|\bdear\b|\b(sir|madam)\b|\bref(erence)?\s*[:.]|\bthis is (to|with|further|in)\b|\bwe (wish|would|hereby|write|are pleased|refer|enclose|request|submit|inform)\b|\bthanking you\b|\byours\b|\bfurther to\b|\bwith reference to\b|\bplease (find|refer|note)\b|\bin continuation\b|\bkindly\b|\byou are\b|\bin accordance with\b|\bthe (company|bank|board)\b/i);
    const raw = stop >= 0 ? rest.slice(0, stop) : rest.slice(0, 300);
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length >= 8) return { line, at: m.index, end: start + raw.length };
  }
  return null;
}

const BODY_START = /\b(this is to (inform|intimate|notify|apprise)|this is (with reference|further|in (continuation|furtherance))|we (wish|would like|are pleased|hereby|write)|you are (kindly )?informed|please (refer|find|note|be informed)|further to|in continuation|the board of directors|the company has)/i;

// Regulation names in a letter's body that would otherwise trip the rules ("Prohibition of Insider Trading").
const BODY_BOILERPLATE = [
  /code of (practices?|conduct)[^.]{0,120}?(unpublished price sensitive information|upsi)/gi,
  /\(?prohibition of insider trading\)?( regulations?,? \d{4})?/gi,
  /\b(sebi|securities and exchange board of india)\s*\([^)]{0,80}\)\s*(regulations?,?\s*\d{4})?/gi,
  /\blisting obligations and disclosure requirements\b/gi,
  /\b(para|part|clause) [a-z0-9]+ of (para|part|schedule) [a-z0-9]+[^,.;]{0,60}/gi,
  /\bregulation\s*30\s*(\(\d+\))?/gi,
  // The standard declaration in every director appointment ("not debarred ... by any order passed by SEBI").
  /[^.]*\bnot debarred\b[^.]*\./gi,
];

const SIGN_OFF = /\b(thanking you|yours (faithfully|sincerely|truly)|sincerely yours|kindly take (the same|this|it|the above) on (your )?record|this is for your (kind )?(information|record)|request you to (kindly )?take)/i;

/** The first sentences of the letter's body, with regulation boilerplate removed. */
export function bodyLead(text: string, sub: { end: number } | null): string {
  let start = sub ? sub.end : text.search(BODY_START);
  if (start < 0) start = 0;
  let lead = text.slice(start, start + 700).replace(/\s+/g, " ");
  const end = lead.search(SIGN_OFF);
  if (end > 0) lead = lead.slice(0, end); // never the signature ("Company Secretary & Compliance Officer")
  for (const re of BODY_BOILERPLATE) lead = lead.replace(re, " ");
  return lead.replace(/\s+/g, " ").trim();
}

// What the body may decide on its own; generic outcomes (compliance, "agreement",
// a press release) wait for the model.
const BODY_TRUSTED = new Set(["litigation", "management_change", "fund_raise", "M&A", "credit_rating", "results", "dividend", "pledging", "capex", "bonus_split"]);
const BODY_TRUSTED_SUB = new Set(["order_win", "business_update", "correction", "clarification"]);

export function classifyLetter(subcategory: string | null, text: string): { category: Category; subtype: string | null; ruleId: string | null; also: Category[]; from: "sub" | "body" } | null {
  const sub = subjectLine(text);
  if (sub) {
    const r = classifyText(subcategory, sub.line, null);
    if (r.category !== "needs_llm") return { ...r, category: r.category, from: "sub" };
  }
  const lead = bodyLead(text, sub);
  if (lead.length < 40) return null;
  const r = classifyText(null, lead, null);
  if (r.category === "needs_llm") return null;
  if (BODY_TRUSTED.has(r.category) || (r.subtype && BODY_TRUSTED_SUB.has(r.subtype))) return { ...r, category: r.category, from: "body" };
  return null;
}

/** Same symbol, results approved within 36 hours, or a results meeting on the calendar within a day. */
function resultsDay(r: Row, meetingDate: string | null, calendar: Map<string, string[]>, results: Map<string, number[]>): boolean {
  const d = meetingDate ?? istDate(r.filed_at);
  const day = Date.parse(`${d}T00:00:00Z`);
  if ((calendar.get(r.symbol) ?? []).some((c) => Math.abs(Date.parse(`${c}T00:00:00Z`) - day) <= 86_400_000)) return true;
  return (results.get(r.symbol) ?? []).some((t) => Math.abs(t - r.filed_at.getTime()) < RESULTS_DAY_MS);
}

export async function classifyNew(limit = 2000, deadline = Date.now() + 120_000): Promise<{ rule: number; context: number; pdf: number; llm: number; fallback: number }> {
  const sql = db();
  const raw = await sql`
    select id, symbol, subject, headline, exchange_subcategory, nse_text, filed_at, pdf_url from announcements
    where status = 'new' order by filed_at limit ${limit}`;
  const rows: Row[] = raw.map((r) => ({
    id: String(r.id), symbol: String(r.symbol), subject: String(r.subject), headline: (r.headline as string | null) ?? null,
    subcategory: (r.exchange_subcategory as string | null) ?? null, nse_text: (r.nse_text as string | null) ?? null,
    filed_at: new Date(r.filed_at as string), pdf_url: (r.pdf_url as string | null) ?? null,
  }));
  const updates: Update[] = [];
  const outcomes: Row[] = [];
  let pending: Row[] = [];
  const notices: { symbol: string; text: string; results: boolean }[] = [];
  for (const r of rows) {
    const res = classifyText(r.subcategory, r.subject, r.headline);
    if (res.ruleId === "R16") notices.push({ symbol: r.symbol, text: `${r.subject} ${r.headline ?? ""}`, results: res.subtype === "results_notice" });
    if (res.category === "needs_llm") { (res.ruleId === "R41" ? outcomes : pending).push(r); continue; }
    updates.push({ id: r.id, category: res.category, subtype: res.subtype, by: `rule:${res.ruleId}`, also: res.also });
  }
  const byRule = updates.length;

  // Results meetings announced in notices go on the calendar (and moved meetings move).
  if (notices.length) await noteMeetings(notices);

  // 1. A bare board outcome on a results day is the results.
  let byContext = 0;
  if (outcomes.length) {
    const symbols = [...new Set(outcomes.map((r) => r.symbol))];
    const calendar = new Map<string, string[]>();
    for (const c of await sql`select symbol, meeting_date::text as d from upcoming_results where symbol in ${sql(symbols)}`) {
      calendar.set(String(c.symbol), [...(calendar.get(String(c.symbol)) ?? []), String(c.d)]);
    }
    const results = new Map<string, number[]>();
    const add = (s: string, t: number) => results.set(s, [...(results.get(s) ?? []), t]);
    const from = new Date(Math.min(...outcomes.map((r) => r.filed_at.getTime())) - RESULTS_DAY_MS);
    const to = new Date(Math.max(...outcomes.map((r) => r.filed_at.getTime())) + RESULTS_DAY_MS);
    for (const a of await sql`select symbol, filed_at from announcements where symbol in ${sql(symbols)}
        and category = 'results' and subtype = 'financial_results' and filed_at between ${from} and ${to}`) {
      add(String(a.symbol), new Date(a.filed_at as string).getTime());
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const u of updates) {
      if (u.category === "results" && u.subtype === "financial_results") { const r = byId.get(u.id)!; add(r.symbol, r.filed_at.getTime()); }
    }
    for (const r of outcomes) {
      if (resultsDay(r, noticeDates(`${r.subject} ${r.headline ?? ""}`).date, calendar, results)) {
        updates.push({ id: r.id, category: "results", subtype: "financial_results", by: "rule:R41+results_day", also: [] });
        byContext++;
      } else pending.push(r);
    }
  }

  // 2. Generic disclosures: read the "Sub:" line of the PDF and try the rules again.
  let byPdf = 0;
  const excerpts = new Map<string, string>();
  const readable = pending.filter((r) => r.pdf_url).slice(0, PDF_READS_PER_RUN);
  for (const r of readable) {
    if (Date.now() > deadline - 20_000) break;
    try {
      const doc = await fetchAndStore({ symbol: r.symbol, docType: "filing", url: r.pdf_url!, maxPages: 60 });
      const text = doc.pages.slice(0, 2).join("\n");
      const hit = classifyLetter(r.subcategory, text);
      if (hit) {
        updates.push({ id: r.id, category: hit.category, subtype: hit.subtype, by: `pdf-${hit.from}:${hit.ruleId}`, also: hit.also });
        byPdf++;
        continue;
      }
      const sub = subjectLine(text);
      excerpts.set(r.id, (sub ? text.slice(sub.at) : text).replace(/\s+/g, " ").slice(0, 1500));
    } catch { /* subject and headline only */ }
  }
  const done = new Set(updates.map((u) => u.id));
  pending = pending.filter((r) => !done.has(r.id));

  // 3. The model, with the filing's own words where we have them.
  let byLlm = 0, fallback = 0;
  for (let i = 0; i < pending.length; i += 25) {
    const batch = pending.slice(i, i + 25);
    let results: { id: string; category: Category; subtype: string | null }[] = [];
    if (llmConfigured() && Date.now() < deadline - 10_000) {
      try {
        const prompt = `${CLASSIFY_PROMPT}\n\nFilings:\n${batch.map((r) =>
          `<f id="${r.id}"><subcategory>${r.subcategory ?? ""}</subcategory><subject>${truncate(r.subject, 300)}</subject><headline>${truncate(String(r.headline ?? r.nse_text ?? ""), 500)}</headline>${
            excerpts.has(r.id) ? `<text>${excerpts.get(r.id)}</text>` : ""}</f>`).join("\n")}`;
        const out = await llm({ task: "classify_batch", prompt, schema: ClassifyBatch, ref: "classify" });
        results = out.data.items;
      } catch { results = []; }
    }
    for (const r of batch) {
      const hit = results.find((x) => x.id === r.id);
      if (hit) {
        updates.push({ id: r.id, category: hit.category, subtype: hit.subtype ?? DEFAULT_SUBTYPE[hit.category] ?? null, by: "llm", also: [] });
        byLlm++;
      } else {
        // No model (or no answer): a routine press release, visible but low in the list.
        updates.push({ id: r.id, category: "press_release", subtype: "general", by: "default", also: [] });
        fallback++;
      }
    }
  }
  await writeUpdates(updates);
  return { rule: byRule, context: byContext, pdf: byPdf, llm: byLlm, fallback };
}

export function defaultSubtype(category: string): string | null {
  return DEFAULT_SUBTYPE[category] ?? null;
}
