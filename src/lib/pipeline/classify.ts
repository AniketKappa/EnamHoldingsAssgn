// Stage 3: classify new filings. Rules first (free, about 90%); the rest go to
// the cheapest model in batches of 25 with only subject, headline and
// subcategory. Writes are batched because the database may be an ocean away.
import { db } from "../db";
import { classifyText, type Category } from "./rules";
import { llm, llmConfigured } from "../llm/router";
import { ClassifyBatch } from "../llm/schemas";
import { truncate } from "../text";

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
investor_meetings (analyst or investor meetings), credit_rating, dividend, bonus_split, capex (new capacity or plant), press_release (order wins, launches, partnerships, clarifications),
postal_ballot, agm_egm, pledging (promoter pledges), unclassified (routine compliance paperwork).
A board-meeting outcome that approves financial results is results. A newspaper advertisement of results is results with subtype results_admin.
If a filing covers several items, pick the most material in this order: results, management_change, M&A, fund_raise, litigation, credit_rating, pledging, capex,
insider_trading, dividend, bonus_split, press_release, earnings_call, agm_egm, postal_ballot, investor_meetings, unclassified.
Return one item per filing id.`;

interface Update { id: string; category: string; subtype: string | null; by: string; also: string[] }

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

export async function classifyNew(limit = 2000): Promise<{ rule: number; llm: number; fallback: number }> {
  const sql = db();
  const rows = await sql`
    select id, subject, headline, exchange_subcategory, nse_text from announcements
    where status = 'new' order by filed_at limit ${limit}`;
  const updates: Update[] = [];
  const pending: (typeof rows)[number][] = [];
  for (const r of rows) {
    const res = classifyText(r.exchange_subcategory as string | null, String(r.subject), (r.headline as string | null) ?? null);
    if (res.category === "needs_llm") { pending.push(r); continue; }
    updates.push({ id: String(r.id), category: res.category, subtype: res.subtype, by: `rule:${res.ruleId}`, also: res.also });
  }
  const byRule = updates.length;
  let byLlm = 0, fallback = 0;
  for (let i = 0; i < pending.length; i += 25) {
    const batch = pending.slice(i, i + 25);
    let results: { id: string; category: Category; subtype: string | null }[] = [];
    if (llmConfigured()) {
      try {
        const prompt = `${CLASSIFY_PROMPT}\n\nFilings:\n${batch.map((r) =>
          `<f id="${r.id}"><subcategory>${r.exchange_subcategory ?? ""}</subcategory><subject>${truncate(String(r.subject), 300)}</subject><headline>${truncate(String(r.headline ?? r.nse_text ?? ""), 500)}</headline></f>`).join("\n")}`;
        const out = await llm({ task: "classify_batch", prompt, schema: ClassifyBatch, ref: "classify" });
        results = out.data.items;
      } catch { results = []; }
    }
    for (const r of batch) {
      const hit = results.find((x) => x.id === r.id);
      if (hit) {
        updates.push({ id: String(r.id), category: hit.category, subtype: hit.subtype ?? DEFAULT_SUBTYPE[hit.category] ?? null, by: "llm", also: [] });
        byLlm++;
      } else {
        // No model (or no answer): a routine press release, visible but low in the list.
        updates.push({ id: String(r.id), category: "press_release", subtype: "general", by: "default", also: [] });
        fallback++;
      }
    }
  }
  await writeUpdates(updates);
  return { rule: byRule, llm: byLlm, fallback };
}

export function defaultSubtype(category: string): string | null {
  return DEFAULT_SUBTYPE[category] ?? null;
}
