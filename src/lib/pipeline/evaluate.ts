// Quotable quality numbers (spec 15.1): every extracted results card compared
// with screener's quarterly table for all three periods it shows, and where each
// filing's classification came from.
import { db } from "../db";
import { screenerFor } from "./financials";
import type { Lines, ResultsMetrics } from "./results";

export interface ResultsEval {
  filings: number;
  compared: number;
  within: number;
  rate: number | null;
  misses: string[];
  skipped: string[];
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005 * Math.max(Math.abs(a), Math.abs(b)), 1.01);

/** Compare up to 12 numbers per filing (revenue, EBITDA, PBT, PAT x current, previous, year-ago quarter). */
export async function evalResults(deadline = Date.now() + 240_000): Promise<ResultsEval> {
  const sql = db();
  const rows = await sql`select r.announcement_id, r.symbol, r.basis, r.template, r.periods, r.metrics
    from results_extracts r order by r.created_at desc limit 40`;
  const out: ResultsEval = { filings: 0, compared: 0, within: 0, rate: null, misses: [], skipped: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const symbol = String(r.symbol);
    if (seen.has(symbol) || Date.now() > deadline) continue;
    seen.add(symbol);
    try {
      const sc = await screenerFor(symbol, 12);
      if (sc.basis !== r.basis) { out.skipped.push(`${symbol}: ours ${r.basis}, screener ${sc.basis}`); continue; }
      const q = sc.tables.quarters;
      if (!q) { out.skipped.push(`${symbol}: no quarterly table`); continue; }
      const p = r.periods as { current: Lines; prev_q: Lines; yoy_q: Lines };
      const m = r.metrics as ResultsMetrics;
      const lender = r.template === "lender";
      out.filings++;
      for (const [name, lines, ebitda] of [["current", p.current, m.ebitda.value], ["previous", p.prev_q, m.ebitda.prev], ["year-ago", p.yoy_q, m.ebitda.yoy]] as const) {
        const end = (lines?.period_end ?? "").slice(0, 7);
        const col = q.periods.findIndex((x) => (x.date ?? "").slice(0, 7) === end);
        if (!end || col < 0) continue;
        const val = (k: string) => q.rows.find((x) => x.key === k)?.values[col] ?? null;
        const pairs: [string, number | null, number | null][] = lender
          ? [["PBT", lines.pbt, val("pbt")], ["PAT", lines.pat_total, val("pat")]]
          : [["Revenue", lines.revenue, val("revenue")], ["EBITDA", ebitda, val("ebitda")], ["PBT", lines.pbt, val("pbt")], ["PAT", lines.pat_total, val("pat")]];
        for (const [line, ours, theirs] of pairs) {
          if (ours === null || theirs === null) continue;
          out.compared++;
          if (near(ours, theirs)) out.within++;
          else out.misses.push(`${symbol} ${name} ${line}: ours ${ours}, screener ${theirs}`);
        }
      }
    } catch (e) {
      out.skipped.push(`${symbol}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  out.rate = out.compared ? Math.round((out.within / out.compared) * 1000) / 10 : null;
  return out;
}

/** Where classifications came from: rules, the results-day context, the letter, the model, or the default. */
export async function classificationSources(): Promise<Record<string, number>> {
  const rows = await db()`select case
      when classified_by like 'rule:%+%' then 'context'
      when classified_by like 'rule:%' then 'rules'
      when classified_by like 'pdf-%' then 'letter'
      when classified_by = 'llm' then 'model'
      when classified_by = 'default' then 'default'
      else coalesce(classified_by, 'unclassified') end as source, count(*)::int as n
    from announcements group by 1 order by 2 desc`;
  return Object.fromEntries(rows.map((r) => [String(r.source), Number(r.n)]));
}
