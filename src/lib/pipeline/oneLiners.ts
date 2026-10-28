// Mid-tier events earn one line, numbers first, with the deal or order size in
// ₹ crore so code can size it against the company (spec 5.3). Batched: up to 25
// filings per cheap-model call. Routine filings never reach this stage.
import { db } from "../db";
import { llm, llmConfigured } from "../llm/router";
import { OneLinerBatch } from "../llm/schemas";
import { numbersIn, truncate } from "../text";
import { fetchAndStore } from "./filings";
import { extractorFor } from "./events";

const PROMPT = `For each filing, write one line of at most 140 characters telling an investor what happened, numbers first.
No adjectives and no company name (it is shown separately). Use plain verbs.
If a main amount is stated (deal value, order value, amount raised, capex, penalty or claim), give it in Rs crore
(lakh / 100, million / 10, billion x 100; USD x 88 only if no rupee figure is given) and copy the short phrase it came from into amount_quote.
For credit ratings give direction up, down or same versus the previous rating; for pledges, up when pledged shares increase.
failed_vote is true only when a shareholder resolution was not passed.
Never use: robust, significant, notably, impressive, strong, delve, landscape.`;

export interface OneLinerDetail {
  one_liner: string;
  amount_cr: number | null;
  amount_quote: string | null;
  direction: "up" | "down" | "same" | null;
  failed_vote: boolean | null;
}

/** True when the quoted amount phrase really is in the filing text. */
export function amountGrounded(quote: string | null, amountCr: number | null, text: string): boolean {
  if (amountCr === null) return true;
  if (!quote) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[\s,]+/g, "");
  if (!norm(text).includes(norm(quote))) {
    // Accept when every number in the quote appears in the text.
    const nums = numbersIn(quote);
    if (!nums.length) return false;
    const textNums = new Set(numbersIn(text));
    if (!nums.every((n) => textNums.has(n))) return false;
  }
  return true;
}

function flagsFor(category: string, subtype: string | null, d: OneLinerDetail, text: string): string[] {
  const f: string[] = [];
  if (category === "credit_rating" && (d.direction === "down" || subtype === "downgrade")) f.push("Rating downgrade");
  if (category === "pledging" && subtype === "pledge_create") f.push("New promoter pledge");
  if (category === "pledging" && /invocation|invoked/i.test(text)) f.push("Pledge invoked");
  if (category === "litigation" && subtype === "regulatory_action" && /penalty|fine|disgorge/i.test(text)) f.push("Regulatory penalty");
  return f;
}

export async function oneLinersPending(limit = 50, deadline = Date.now() + 120_000): Promise<{ done: number; failed: number }> {
  if (!llmConfigured()) return { done: 0, failed: 0 };
  const sql = db();
  const rows = await sql`
    select e.event_key, e.category, e.subtype, e.symbol, e.detail, a.id as ann_id, a.subject, a.headline, a.pdf_url
    from events e join announcements a on a.id = e.primary_id
    where e.status = 'pending' and e.category not in ('results', 'management_change') and e.attempts < 3
    order by e.first_filed_at desc limit ${limit * 2}`;
  const todo = rows.filter((r) => extractorFor(String(r.category), (r.subtype as string | null) ?? null, String(r.subject)) === "one_liner").slice(0, limit);
  if (!todo.length) return { done: 0, failed: 0 };

  // Filing text: the first two pages are where the amount and the action live.
  const texts = new Map<string, string>();
  for (const r of todo) {
    if (Date.now() > deadline) break;
    let text = `${r.subject}\n${r.headline ?? ""}`;
    if (r.pdf_url) {
      try {
        const doc = await fetchAndStore({ symbol: String(r.symbol), docType: "filing", url: String(r.pdf_url), maxPages: 6 });
        text += `\n${doc.pages.slice(0, 3).join("\n")}`;
      } catch { /* subject and headline only */ }
    }
    texts.set(String(r.event_key), text);
  }
  const ready = todo.filter((r) => texts.has(String(r.event_key)));
  let done = 0, failed = 0;

  for (let i = 0; i < ready.length; i += 25) {
    if (Date.now() > deadline) break;
    const batch = ready.slice(i, i + 25);
    let items: (OneLinerDetail & { id: string })[] = [];
    {
      try {
        const prompt = `${PROMPT}\n\nFilings:\n${batch.map((r) => `<f id="${r.event_key}"><category>${r.category}${r.subtype ? `/${r.subtype}` : ""}</category><text>${truncate(texts.get(String(r.event_key)) ?? "", 1800)}</text></f>`).join("\n")}`;
        const out = await llm({ task: "one_liners_batch", prompt, schema: OneLinerBatch, ref: "one_liners" });
        items = out.data.items;
      } catch (e) {
        await sql`update events set attempts = attempts + 1, error = ${String((e as Error).message).slice(0, 300)}
          where event_key in ${sql(batch.map((b) => String(b.event_key)))}`;
        failed += batch.length;
        continue;
      }
    }
    for (const r of batch) {
      const key = String(r.event_key);
      const text = texts.get(key) ?? "";
      const hit = items.find((x) => x.id === key);
      const d: OneLinerDetail = hit
        ? {
          one_liner: hit.one_liner,
          amount_cr: hit.amount_cr !== null && hit.amount_cr > 0 && amountGrounded(hit.amount_quote, hit.amount_cr, text) ? hit.amount_cr : null,
          amount_quote: hit.amount_quote,
          direction: hit.direction,
          failed_vote: hit.failed_vote,
        }
        : { one_liner: "", amount_cr: null, amount_quote: null, direction: null, failed_vote: null };
      const flags = flagsFor(String(r.category), (r.subtype as string | null) ?? null, d, text);
      await sql`update announcements set one_liner = ${d.one_liner || null}, amount_cr = ${d.amount_cr} where id = ${String(r.ann_id)}`;
      await sql`update events set
        title = ${d.one_liner ? d.one_liner : sql`title`},
        red_flags = ${sql.json(flags)},
        detail = ${sql.json({ ...((r.detail as object) ?? {}), ...d, subject: r.subject, pdf_url: r.pdf_url ?? null } as never)},
        status = 'done', updated_at = now()
        where event_key = ${key}`;
      done++;
    }
  }
  return { done, failed };
}
