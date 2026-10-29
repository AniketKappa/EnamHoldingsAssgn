// Stage 5: run the right extractor for each pending event, most valuable
// first (results, then people, then batched one-liners), inside a deadline.
// A failed extraction never hides an event: it keeps its title and filing link.
import { db } from "../db";
import { llmConfigured } from "../llm/router";
import { extractResultsEvent } from "./extractResults";
import { extractPeopleEvent, retryBackgrounds } from "./extractPeople";
import { oneLinersPending } from "./oneLiners";
import { rescoreEvent } from "./events";

const MAX_ATTEMPTS = 3;

async function runOne(eventKey: string, fn: (k: string) => Promise<unknown>): Promise<boolean> {
  const sql = db();
  try {
    await fn(eventKey);
    await sql`update events set status = 'done', error = null, updated_at = now() where event_key = ${eventKey}`;
    await rescoreEvent(eventKey);
    return true;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 400);
    await sql`update events set attempts = attempts + 1, error = ${msg},
      status = case when attempts + 1 >= ${MAX_ATTEMPTS} then 'failed' else status end, updated_at = now()
      where event_key = ${eventKey}`;
    await rescoreEvent(eventKey);
    return false;
  }
}

export async function extractPending(deadline = Date.now() + 180_000): Promise<Record<string, number>> {
  const out = { results: 0, people: 0, one_liners: 0, failed: 0, backgrounds: 0 };
  if (!llmConfigured()) return out;
  const sql = db();
  // Newest first: today's results matter more than a backfilled month.
  const results = await sql`select event_key from events where status = 'pending' and category = 'results'
    and subtype = 'financial_results' and attempts < ${MAX_ATTEMPTS} order by first_filed_at desc limit 12`;
  for (const r of results) {
    if (Date.now() > deadline - 45_000) break;
    if (await runOne(String(r.event_key), extractResultsEvent)) out.results++; else out.failed++;
  }
  const people = await sql`select event_key from events where status = 'pending' and category = 'management_change'
    and attempts < ${MAX_ATTEMPTS} order by first_filed_at desc limit 12`;
  for (const r of people) {
    if (Date.now() > deadline - 40_000) break;
    if (await runOne(String(r.event_key), extractPeopleEvent)) out.people++; else out.failed++;
  }
  if (Date.now() < deadline - 30_000) {
    const ol = await oneLinersPending(50, deadline - 10_000);
    out.one_liners = ol.done;
    out.failed += ol.failed;
    const keys = await sql`select event_key from events where status = 'done' and updated_at > now() - interval '10 minutes'
      and category not in ('results', 'management_change')`;
    for (const k of keys) await rescoreEvent(String(k.event_key));
  }
  if (Date.now() < deadline - 40_000) out.backgrounds = await retryBackgrounds(deadline).catch(() => 0);
  return out;
}
